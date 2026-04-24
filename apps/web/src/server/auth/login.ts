import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createDb } from "@ossmeet/db";
import { users, sessions, verifications, passkeys } from "@ossmeet/db/schema";
import {
  hashSessionToken,
  generateSessionToken,
  hashOtp,
  generateOTP,
} from "@/lib/auth/crypto";
import {
  normalizeEmail,
  SESSION_EXPIRY_MS,
  SESSION_EXPIRY_SECONDS,
  SESSION_ABSOLUTE_EXPIRY_MS,
  OTP_EXPIRY_MS,
  generateId,
  d1MaxItemsPerStatement,
} from "@ossmeet/shared";
import { loginSchema, otpVerifySchema, resendOtpSchema, checkEmailSchema, Errors, createValidationError } from "@ossmeet/shared";
import { eq, and, gte, lt, or, inArray } from "drizzle-orm";
import { sendEmail, buildOtpEmail } from "@/lib/email";
import {
  getEnv,
  getClientIP,
  getSessionIdsFromCookie,
  createCookieString,
  getSessionFromRequest,
  getRememberedUserFromRequest,
  sanitizeUser,
  enforceRateLimit,
  enforceIpRateLimit,
  appendCookies,
  enforceSessionCap,
  rememberDevice,
  checkDisposableEmail,
} from "./helpers";
import { verifyOtpWithAttempts } from "./signup";

/**
 * Email-first auth helper:
 * tells the UI whether this email already has an account so it can branch
 * to login OTP/passkey or new-user name capture.
 */
export const checkEmailStatus = createServerFn({ method: "POST" })
  .inputValidator(checkEmailSchema)
  .handler(async ({ data }) => {
    const env = await getEnv();
    const db = createDb(env.DB);
    const normalized = normalizeEmail(data.email);

    await enforceIpRateLimit(env, "email-check");
    await enforceRateLimit(env, `email-check:${normalized}`, true);
    await checkDisposableEmail(normalized);

    const user = await db.query.users.findFirst({
      where: eq(users.normalizedEmail, normalized),
      columns: { id: true },
    });

    if (!user) {
      return { exists: false, hasPasskey: false };
    }

    const passkey = await db.query.passkeys.findFirst({
      where: eq(passkeys.userId, user.id),
      columns: { id: true },
    });

    return { exists: true, hasPasskey: !!passkey };
  });

/**
 * Step 1 of OTP login — send a one-time code to the email address.
 * Returns { email } regardless of whether the address is registered
 * to prevent email enumeration.
 */
export const login = createServerFn({ method: "POST" })
  .inputValidator(loginSchema)
  .handler(async ({ data }) => {
    const env = await getEnv();
    const db = createDb(env.DB);
    const normalized = normalizeEmail(data.email);

    await enforceIpRateLimit(env, "login");
    await enforceRateLimit(env, `login:${normalized}`, true);
    await checkDisposableEmail(normalized);

    const user = await db.query.users.findFirst({
      where: eq(users.normalizedEmail, normalized),
      columns: { id: true, email: true },
    });

    // Always run OTP hash to equalize timing regardless of whether user exists
    const otp = generateOTP();
    const otpHash = await hashOtp(otp, normalized, env.AUTH_SECRET);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

    if (!env.RESEND_API_KEY) {
      throw Errors.CONFIG_ERROR("Email authentication is not configured");
    }

    if (!user) {
      return { email: data.email };
    }

    const cooldownThreshold = new Date(now.getTime() - 60_000);
    const insertResult = await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        type: "otp_login" as const,
        identifier: `login:${normalized}`,
        value: otpHash,
        data: null,
        expiresAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [verifications.type, verifications.identifier],
        set: { value: otpHash, data: null, expiresAt, updatedAt: now },
        setWhere: lt(verifications.updatedAt, cooldownThreshold),
      })
      .run();

    const changes = (insertResult as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes > 0) {
      const { subject, html } = buildOtpEmail(otp, "login");
      await sendEmail(env.RESEND_API_KEY, { to: user.email, subject, html }).catch(() => {});
    }

    return { email: data.email };
  });

/**
 * Step 2 of OTP login — verify the code and create a session.
 */
export const verifyLoginOtp = createServerFn({ method: "POST" })
  .inputValidator(otpVerifySchema)
  .handler(async ({ data }) => {
    const request = getRequest();
    const env = await getEnv();
    const db = createDb(env.DB);
    const normalized = normalizeEmail(data.email);

    await enforceIpRateLimit(env, "login-otp-verify");
    await enforceRateLimit(env, `login-otp-verify:${normalized}`, true);

    const verification = await db.query.verifications.findFirst({
      where: and(
        eq(verifications.type, "otp_login"),
        eq(verifications.identifier, `login:${normalized}`),
        gte(verifications.expiresAt, new Date())
      ),
    });
    if (!verification) throw createValidationError("Invalid or expired code.");

    const otpHash = await hashOtp(data.otp, normalized, env.AUTH_SECRET);
    await verifyOtpWithAttempts(db, verification, otpHash);

    const user = await db.query.users.findFirst({
      where: eq(users.normalizedEmail, normalized),
    });
    if (!user) throw Errors.UNAUTHORIZED();

    await db.delete(verifications).where(eq(verifications.id, verification.id)).catch(() => {});

    const sessionToken = generateSessionToken();
    const sessionTokenHash = await hashSessionToken(sessionToken);
    const now = Date.now();
    const expiresAt = new Date(now + SESSION_EXPIRY_MS);
    const absoluteExpiresAt = new Date(now + SESSION_ABSOLUTE_EXPIRY_MS);

    await db.insert(sessions).values({
      id: generateId("SESSION"),
      tokenHash: sessionTokenHash,
      userId: user.id,
      expiresAt,
      absoluteExpiresAt,
      ipAddress: getClientIP(),
      userAgent: request.headers.get("User-Agent")?.slice(0, 500) ?? null,
    });

    await enforceSessionCap(db, user.id);
    await rememberDevice(db, env, user.id).catch(() => {});

    appendCookies([
      createCookieString("session", sessionToken, SESSION_EXPIRY_SECONDS, {
        appUrl: env.APP_URL,
        environment: env.ENVIRONMENT,
      }),
    ]);

    return { user: sanitizeUser(user) };
  });

/**
 * Resend a login OTP (60-second cooldown).
 */
export const resendLoginOtp = createServerFn({ method: "POST" })
  .inputValidator(resendOtpSchema)
  .handler(async ({ data }) => {
    const env = await getEnv();
    const db = createDb(env.DB);
    const normalized = normalizeEmail(data.email);

    await enforceIpRateLimit(env, "login-otp-resend");
    await enforceRateLimit(env, `login-otp-resend:${normalized}`, true);
    await checkDisposableEmail(normalized);

    const user = await db.query.users.findFirst({
      where: eq(users.normalizedEmail, normalized),
      columns: { id: true, email: true },
    });

    if (!user) return { resent: false };

    const pending = await db.query.verifications.findFirst({
      where: and(
        eq(verifications.type, "otp_login"),
        eq(verifications.identifier, `login:${normalized}`)
      ),
    });
    if (!pending) return { resent: false };

    const otp = generateOTP();
    const otpHash = await hashOtp(otp, normalized, env.AUTH_SECRET);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);
    const cooldownThreshold = new Date(now.getTime() - 60_000);

    if (!env.RESEND_API_KEY) {
      throw Errors.CONFIG_ERROR("Email authentication is not configured");
    }

    const insertResult = await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        type: "otp_login" as const,
        identifier: `login:${normalized}`,
        value: otpHash,
        data: null,
        expiresAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [verifications.type, verifications.identifier],
        set: { value: otpHash, data: null, expiresAt, updatedAt: now },
        setWhere: lt(verifications.updatedAt, cooldownThreshold),
      })
      .run();

    const changes = (insertResult as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes === 0) return { resent: false };

    const { subject, html } = buildOtpEmail(otp, "login");
    await sendEmail(env.RESEND_API_KEY, { to: user.email, subject, html }).catch(() => {});

    return { resent: true };
  });

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  return getSessionFromRequest();
});

export const getRememberedUser = createServerFn({ method: "GET" }).handler(async () => {
  return getRememberedUserFromRequest();
});

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  const env = await getEnv();
  const db = createDb(env.DB);
  const cookie = request.headers.get("Cookie");
  const sessionTokens = Array.from(new Set(getSessionIdsFromCookie(cookie))).slice(
    0,
    d1MaxItemsPerStatement(2),
  );

  if (sessionTokens.length > 0) {
    const tokenHashes = await Promise.all(
      sessionTokens.map((t) => hashSessionToken(t))
    );
    await db.delete(sessions).where(
      or(
        inArray(sessions.tokenHash, tokenHashes),
        inArray(sessions.previousTokenHash, tokenHashes)
      )
    );
  }

  appendCookies([
    createCookieString("session", "", 0, {
      appUrl: env.APP_URL,
      environment: env.ENVIRONMENT,
    }),
  ]);

  return { success: true };
});
