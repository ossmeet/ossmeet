import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createDb } from "@ossmeet/db";
import type { Database } from "@ossmeet/db";
import { users, sessions, verifications } from "@ossmeet/db/schema";
import {
  hashOtp,
  generateOTP,
  hashSessionToken,
  generateSessionToken,
  timingSafeCompareHex,
} from "@/lib/auth/crypto";
import { normalizeEmail, SESSION_EXPIRY_MS, SESSION_EXPIRY_SECONDS, SESSION_ABSOLUTE_EXPIRY_MS, OTP_EXPIRY_MS, generateId } from "@ossmeet/shared";
import {
  signUpSchema,
  otpVerifySchema,
  resendOtpSchema,
  Errors,
  createValidationError,
} from "@ossmeet/shared";
import { eq, and, lt, gte, sql } from "drizzle-orm";
import { sendEmail, buildOtpEmail } from "@/lib/email";
import {
  getEnv,
  getClientIP,
  createCookieString,
  sanitizeUser,
  enforceRateLimit,
  enforceIpRateLimit,
  appendCookies,
  checkDisposableEmail,
  enforceSessionCap,
  rememberDevice,
} from "./helpers";

const MAX_OTP_ATTEMPTS = 5;

/**
 * Verify a hashed OTP against a verification record, enforcing attempt counting.
 * Uses an atomic SQL increment to prevent concurrent wrong-OTP requests from
 * each reading the same counter value and collectively bypassing the limit.
 */
export async function verifyOtpWithAttempts(
  db: Database,
  verification: { id: string; value: string; data: string | null },
  otpHash: string
): Promise<void> {
  const safeVerificationData = sql`CASE WHEN json_valid(${verifications.data}) THEN COALESCE(${verifications.data}, '{}') ELSE '{}' END`;

  await db.update(verifications)
    .set({
      data: sql`json_set(${safeVerificationData}, '$._attempts', COALESCE(json_extract(${safeVerificationData}, '$._attempts'), 0) + 1)`,
      updatedAt: new Date(),
    })
    .where(eq(verifications.id, verification.id));

  const refreshed = await db.query.verifications.findFirst({
    where: eq(verifications.id, verification.id),
  });
  if (!refreshed) throw createValidationError("Invalid or expired OTP");

  const refreshedData: Record<string, unknown> = refreshed.data
    ? (() => { try { return JSON.parse(refreshed.data!); } catch { return {}; } })()
    : {};
  const attempts = typeof refreshedData._attempts === "number" ? refreshedData._attempts : 0;

  if (attempts > MAX_OTP_ATTEMPTS) {
    await db.delete(verifications).where(eq(verifications.id, refreshed.id)).catch(() => {});
    throw createValidationError("Too many failed attempts. Please request a new code.");
  }

  if (!timingSafeCompareHex(refreshed.value, otpHash)) {
    throw createValidationError("Invalid or expired OTP");
  }
}

export const signUp = createServerFn({ method: "POST" })
  .inputValidator(signUpSchema)
  .handler(async ({ data }) => {
    const env = await getEnv();
    const db = createDb(env.DB);
    const originalEmail = data.email;
    const normalized = normalizeEmail(data.email);

    await enforceIpRateLimit(env, "signup");
    await enforceRateLimit(env, `signup:${normalized}`, true);

    const existingUser = await db.query.users.findFirst({
      where: eq(users.normalizedEmail, normalized),
    });

    if (existingUser) {
      return { email: originalEmail };
    }

    await checkDisposableEmail(normalized);

    const pendingData = JSON.stringify({
      name: data.name,
      email: originalEmail,
      normalizedEmail: normalized,
    });

    const now = new Date();
    const otp = generateOTP();
    const otpHash = await hashOtp(otp, normalized, env.AUTH_SECRET);
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

    if (!env.RESEND_API_KEY) {
      throw Errors.CONFIG_ERROR("Email authentication is not configured");
    }

    const insertResult = await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        type: "otp_signup" as const,
        identifier: `signup:${normalized}`,
        value: otpHash,
        data: pendingData,
        expiresAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [verifications.type, verifications.identifier],
        set: { value: otpHash, data: pendingData, expiresAt, updatedAt: now },
        setWhere: lt(verifications.expiresAt, now),
      })
      .run();

    const changes = (insertResult as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes === 0) {
      return { email: originalEmail };
    }

    const { subject, html } = buildOtpEmail(otp, "signup");
    const sent = await sendEmail(env.RESEND_API_KEY, { to: originalEmail, subject, html });
    if (!sent) {
      throw Errors.VALIDATION("Failed to send verification email. Please try again.");
    }

    return { email: originalEmail };
  });

export const verifyOTP = createServerFn({ method: "POST" })
  .inputValidator(otpVerifySchema)
  .handler(async ({ data }) => {
    const request = getRequest();
    const env = await getEnv();
    const db = createDb(env.DB);
    const normalized = normalizeEmail(data.email);

    await enforceIpRateLimit(env, "otp-verify");
    await enforceRateLimit(env, `otp-verify:${normalized}`, true);

    const existingUser = await db.query.users.findFirst({
      where: eq(users.normalizedEmail, normalized),
    });
    if (existingUser) {
      throw createValidationError("An account with this email already exists.");
    }

    const existingVerification = await db.query.verifications.findFirst({
      where: and(
        eq(verifications.type, "otp_signup"),
        eq(verifications.identifier, `signup:${normalized}`),
        gte(verifications.expiresAt, new Date())
      ),
    });
    if (!existingVerification) throw createValidationError("Invalid or expired OTP");

    const otpHash = await hashOtp(data.otp, normalized, env.AUTH_SECRET);
    await verifyOtpWithAttempts(db, existingVerification, otpHash);

    if (!existingVerification.data) throw createValidationError("Invalid verification data");

    let pendingData: {
      name: string;
      email: string;
      normalizedEmail: string;
    };
    try {
      pendingData = JSON.parse(existingVerification.data) as {
        name: string;
        email: string;
        normalizedEmail: string;
      };
    } catch {
      throw createValidationError("Invalid verification data");
    }

    const now = new Date();
    const userId = generateId("USER");
    const sessionToken = generateSessionToken();
    const sessionTokenHash = await hashSessionToken(sessionToken);
    const sessionNow = Date.now();
    const expiresAt = new Date(sessionNow + SESSION_EXPIRY_MS);
    const absoluteExpiresAt = new Date(sessionNow + SESSION_ABSOLUTE_EXPIRY_MS);

    const userRecord: typeof users.$inferInsert = {
      id: userId,
      email: pendingData.email,
      normalizedEmail: pendingData.normalizedEmail,
      name: pendingData.name,
      image: null,
      plan: "free",
      role: "user",
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.batch([
        db.insert(users).values(userRecord),
        db.insert(sessions).values({
          id: generateId("SESSION"),
          tokenHash: sessionTokenHash,
          userId,
          expiresAt,
          absoluteExpiresAt,
          ipAddress: getClientIP(),
          userAgent: request.headers.get("User-Agent")?.slice(0, 500) ?? null,
        }),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("UNIQUE")) {
        throw createValidationError("An account with this email already exists. Please sign in instead.");
      }
      throw err;
    }

    await db.delete(verifications).where(
      and(eq(verifications.type, "otp_signup"), eq(verifications.identifier, `signup:${normalized}`))
    ).catch(() => {});

    try {
      await enforceSessionCap(db, userId);
      await rememberDevice(db, env, userId).catch(() => {});
    } catch {
      // Non-fatal
    }

    appendCookies([
      createCookieString("session", sessionToken, SESSION_EXPIRY_SECONDS, {
        appUrl: env.APP_URL,
        environment: env.ENVIRONMENT,
      }),
    ]);

    return { user: sanitizeUser(userRecord as typeof users.$inferSelect) };
  });

export const resendOTP = createServerFn({ method: "POST" })
  .inputValidator(resendOtpSchema)
  .handler(async ({ data }) => {
    const env = await getEnv();
    const db = createDb(env.DB);
    const normalized = normalizeEmail(data.email);

    await enforceIpRateLimit(env, "otp-resend");
    await enforceRateLimit(env, `otp-resend:${normalized}`, true);

    const pendingSignup = await db.query.verifications.findFirst({
      where: and(
        eq(verifications.type, "otp_signup"),
        eq(verifications.identifier, `signup:${normalized}`)
      ),
    });

    if (!pendingSignup) {
      return { email: data.email, resent: false };
    }

    const pendingData = pendingSignup.data ?? null;

    let recipientEmail: string;
    if (pendingData) {
      try {
        const parsed = JSON.parse(pendingData) as { email?: string };
        if (!parsed.email) {
          return { email: data.email, resent: false };
        }
        recipientEmail = parsed.email;
      } catch {
        return { email: data.email, resent: false };
      }
    } else {
      return { email: data.email, resent: false };
    }

    const otp = generateOTP();
    const otpHash = await hashOtp(otp, normalized, env.AUTH_SECRET);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

    if (!env.RESEND_API_KEY) {
      throw Errors.CONFIG_ERROR("Email authentication is not configured");
    }

    const cooldownThreshold = new Date(now.getTime() - 60_000);
    const insertResult = await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        type: "otp_signup" as const,
        identifier: `signup:${normalized}`,
        value: otpHash,
        data: pendingData,
        expiresAt,
        updatedAt: now,
      })
    .onConflictDoUpdate({
      target: [verifications.type, verifications.identifier],
      set: {
        value: otpHash,
        data: pendingData,
        expiresAt,
        updatedAt: now,
      },
      setWhere: lt(verifications.updatedAt, cooldownThreshold),
    })
      .run();

    const changes = (insertResult as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes === 0) {
      return { email: recipientEmail, resent: false };
    }

    const { subject, html } = buildOtpEmail(otp, "signup");
    const sent = await sendEmail(env.RESEND_API_KEY, { to: recipientEmail, subject, html });
    if (!sent) {
      throw Errors.VALIDATION("Failed to send verification email. Please try again.");
    }

    return { email: recipientEmail, resent: true };
  });
