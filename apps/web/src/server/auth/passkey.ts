import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createDb } from "@ossmeet/db";
import { passkeys, sessions, users, verifications } from "@ossmeet/db/schema";
import { and, eq, gte } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import {
  Errors,
  SESSION_ABSOLUTE_EXPIRY_MS,
  SESSION_EXPIRY_MS,
  SESSION_EXPIRY_SECONDS,
  generateId,
} from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import {
  appendCookies,
  createCookieString,
  enforceIpRateLimit,
  enforceRateLimit,
  getClientIP,
  getEnv,
  rememberDevice,
  sanitizeUser,
  enforceSessionCap,
} from "./helpers";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/crypto";
import { withD1Retry } from "@/lib/db-utils";

const PASSKEY_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const RP_NAME = "OSSMeet";

function getRpConfig(env: Env): { rpID: string; origin: string } {
  const appUrl = new URL(env.APP_URL);
  return { rpID: appUrl.hostname, origin: appUrl.origin };
}

const PASSKEY_TRANSPORTS: readonly AuthenticatorTransportFuture[] = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
];

function parseTransports(raw: string[] | null): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  return raw.filter(
    (t): t is AuthenticatorTransportFuture =>
      typeof t === "string" &&
      PASSKEY_TRANSPORTS.includes(t as AuthenticatorTransportFuture)
  );
}

export const startPasskeyRegistration = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context: { user, env, db } }) => {
    await enforceIpRateLimit(env, "passkey-register-start");
    await enforceRateLimit(env, `passkey-register-start:${user.id}`, true);

    const { rpID } = getRpConfig(env);
    const existing = await db.query.passkeys.findMany({
      where: eq(passkeys.userId, user.id),
      columns: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      excludeCredentials: existing.map((p) => ({
        id: p.credentialId,
        transports: parseTransports(p.transports),
      })),
    });

    const now = new Date();
    await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        type: "passkey_register",
        identifier: `passkey-register:${user.id}`,
        value: options.challenge,
        data: null,
        expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [verifications.type, verifications.identifier],
        set: {
          value: options.challenge,
          data: null,
          expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS),
          updatedAt: now,
        },
      });

    return { options };
  });

export const finishPasskeyRegistration = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw Errors.VALIDATION("Invalid payload");
    const payload = data as { response?: unknown; name?: unknown };
    if (!payload.response || typeof payload.response !== "object") {
      throw Errors.VALIDATION("Invalid passkey response");
    }
    if (payload.name !== undefined && typeof payload.name !== "string") {
      throw Errors.VALIDATION("Invalid passkey name");
    }
    return payload as { response: unknown; name?: string };
  })
  .handler(async ({ data, context: { user, env, db } }) => {
    await enforceIpRateLimit(env, "passkey-register-finish");
    await enforceRateLimit(env, `passkey-register-finish:${user.id}`, true);

    const challengeRow = await db.query.verifications.findFirst({
      where: and(
        eq(verifications.type, "passkey_register"),
        eq(verifications.identifier, `passkey-register:${user.id}`),
        gte(verifications.expiresAt, new Date()),
      ),
    });
    if (!challengeRow) throw Errors.VALIDATION("Passkey registration expired");

    const { rpID, origin } = getRpConfig(env);
    const verification = await verifyRegistrationResponse({
      response: data.response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
      expectedChallenge: challengeRow.value,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw Errors.VALIDATION("Passkey registration failed");
    }

    const registrationInfo = verification.registrationInfo;
    const now = new Date();
    await db
      .insert(passkeys)
      .values({
        id: generateId("PASSKEY"),
        userId: user.id,
        credentialId: registrationInfo.credential.id,
        publicKey: isoBase64URL.fromBuffer(registrationInfo.credential.publicKey),
        counter: registrationInfo.credential.counter,
        deviceType: registrationInfo.credentialDeviceType,
        backedUp: registrationInfo.credentialBackedUp,
        transports: registrationInfo.credential.transports ?? null,
        name: data.name?.trim() ? data.name.trim().slice(0, 120) : null,
        createdAt: now,
        lastUsedAt: now,
      })
      .onConflictDoUpdate({
        target: passkeys.credentialId,
        set: {
          userId: user.id,
          publicKey: isoBase64URL.fromBuffer(registrationInfo.credential.publicKey),
          counter: registrationInfo.credential.counter,
          deviceType: registrationInfo.credentialDeviceType,
          backedUp: registrationInfo.credentialBackedUp,
          transports: registrationInfo.credential.transports ?? null,
          name: data.name?.trim() ? data.name.trim().slice(0, 120) : null,
          lastUsedAt: now,
        },
      });

    await db.delete(verifications).where(eq(verifications.id, challengeRow.id));
    return { success: true };
  });

export const startPasskeyAuthentication = createServerFn({ method: "POST" }).handler(async () => {
  const env = await getEnv();
  const db = createDb(env.DB);
  await enforceIpRateLimit(env, "passkey-auth-start");
  await enforceRateLimit(env, `passkey-auth-start:${getClientIP()}`, true);

  const { rpID } = getRpConfig(env);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });

  const challengeId = crypto.randomUUID();
  const now = new Date();
  await db.insert(verifications).values({
    id: crypto.randomUUID(),
    type: "passkey_auth",
    identifier: `passkey-auth:${challengeId}`,
    value: options.challenge,
    data: null,
    expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS),
    updatedAt: now,
  });

  return { challengeId, options };
});

export const finishPasskeyAuthentication = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw Errors.VALIDATION("Invalid payload");
    const payload = data as { challengeId?: unknown; response?: unknown };
    if (typeof payload.challengeId !== "string" || payload.challengeId.length < 8) {
      throw Errors.VALIDATION("Invalid challenge");
    }
    if (!payload.response || typeof payload.response !== "object") {
      throw Errors.VALIDATION("Invalid passkey response");
    }
    return payload as { challengeId: string; response: unknown };
  })
  .handler(async ({ data }) => {
    const request = getRequest();
    const env = await getEnv();
    const db = createDb(env.DB);

    await enforceIpRateLimit(env, "passkey-auth-finish");
    await enforceRateLimit(env, `passkey-auth-finish:${getClientIP()}`, true);

    const consumedChallenge = await db
      .delete(verifications)
      .where(
        and(
          eq(verifications.type, "passkey_auth"),
          eq(verifications.identifier, `passkey-auth:${data.challengeId}`),
          gte(verifications.expiresAt, new Date()),
        ),
      )
      .returning();
    if (consumedChallenge.length === 0) throw Errors.UNAUTHORIZED();
    const challengeRow = consumedChallenge[0];

    const authResponse = data.response as { id: string };
    const credentialId = authResponse.id;
    const stored = await db.query.passkeys.findFirst({
      where: eq(passkeys.credentialId, credentialId),
    });
    if (!stored) throw Errors.UNAUTHORIZED();

    const credential: WebAuthnCredential = {
      id: stored.credentialId,
      publicKey: isoBase64URL.toBuffer(stored.publicKey),
      counter: stored.counter,
      transports: parseTransports(stored.transports),
    };

    const { rpID, origin } = getRpConfig(env);
    const verification = await verifyAuthenticationResponse({
      response: data.response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
      expectedChallenge: challengeRow.value,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential,
      requireUserVerification: false,
    });

    if (!verification.verified) {
      throw Errors.UNAUTHORIZED();
    }

    const authInfo = verification.authenticationInfo;
    const now = new Date();
    await db
      .update(passkeys)
      .set({
        counter: authInfo.newCounter,
        lastUsedAt: now,
        backedUp: authInfo.credentialBackedUp ?? stored.backedUp,
      })
      .where(eq(passkeys.id, stored.id));

    const user = await db.query.users.findFirst({ where: eq(users.id, stored.userId) });
    if (!user) throw Errors.UNAUTHORIZED();

    const sessionToken = generateSessionToken();
    const sessionTokenHash = await hashSessionToken(sessionToken);
    const nowMs = Date.now();
    await withD1Retry(() =>
      db.insert(sessions).values({
        id: generateId("SESSION"),
        tokenHash: sessionTokenHash,
        userId: user.id,
        expiresAt: new Date(nowMs + SESSION_EXPIRY_MS),
        absoluteExpiresAt: new Date(nowMs + SESSION_ABSOLUTE_EXPIRY_MS),
        ipAddress: getClientIP(),
        userAgent: request.headers.get("User-Agent")?.slice(0, 500) ?? null,
      }),
    );

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

export const listPasskeys = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { user, db } }) => {
    const rows = await db.query.passkeys.findMany({
      where: eq(passkeys.userId, user.id),
      columns: {
        id: true,
        name: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: (p, { desc }) => [desc(p.lastUsedAt), desc(p.createdAt)],
    });
    return rows;
  });

export const deletePasskey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw Errors.VALIDATION("Invalid payload");
    const payload = data as { passkeyId?: unknown };
    if (typeof payload.passkeyId !== "string" || payload.passkeyId.length < 1) {
      throw Errors.VALIDATION("Invalid passkey id");
    }
    return { passkeyId: payload.passkeyId };
  })
  .handler(async ({ data, context: { user, db, env } }) => {
    await enforceIpRateLimit(env, "passkey-delete");
    await enforceRateLimit(env, `passkey-delete:${user.id}`, true);

    const found = await db.query.passkeys.findFirst({
      where: and(eq(passkeys.id, data.passkeyId), eq(passkeys.userId, user.id)),
      columns: { id: true },
    });
    if (!found) throw Errors.NOT_FOUND("Passkey");

    await db.delete(passkeys).where(eq(passkeys.id, found.id));
    return { success: true };
  });
