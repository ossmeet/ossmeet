import { createDb } from "@ossmeet/db";
import { users, accounts, sessions, verifications } from "@ossmeet/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { normalizeEmail, SESSION_EXPIRY_MS, SESSION_EXPIRY_SECONDS, SESSION_ABSOLUTE_EXPIRY_MS, generateId } from "@ossmeet/shared";
import { hashSessionToken, generateSessionToken } from "@/lib/auth/crypto";
import { getEnv, getEnvFromRequest, createCookieString, getClientIP, sanitizeUser, enforceIpRateLimit, enforceSessionCap, appendCookies, rememberDevice } from "./helpers";
import { Errors } from "@ossmeet/shared";
import { logInfo } from "@/lib/logger";
import { withD1Retry } from "@/lib/db-utils";
import { sanitizeDisplayName } from "@/lib/sanitize";
import { hasOAuthStateHash, removeOAuthStateHash } from "./oauth-state";
import { exchangeAndVerifyGoogleCode, decryptVerifier } from "./oauth-google";

export async function handleGoogleCallbackRequest(
  request: Request,
  data: { code: string; state: string }
) {
  const env = await getEnvFromRequest(request) ?? await getEnv();
  const db = createDb(env.DB);

  await enforceIpRateLimit(env, "oauth-callback");

  const cookie = request.headers.get("Cookie") ?? "";
  const stateCookieMatch = cookie.match(/(?:^|;\s*)oauth_state=([^;]+)/);
  const stateCookieValue = stateCookieMatch?.[1];
  if (!stateCookieValue) {
    throw Errors.OAUTH_ERROR("Missing OAuth state cookie");
  }

  const expectedStateHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data.state)
  );
  const expectedHashHex = Array.from(new Uint8Array(expectedStateHash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (!hasOAuthStateHash(stateCookieValue, expectedHashHex)) {
    throw Errors.OAUTH_ERROR("OAuth state mismatch");
  }

  const remainingStateHashes = removeOAuthStateHash(stateCookieValue, expectedHashHex);
  appendCookies([
    createCookieString("oauth_state", remainingStateHashes, remainingStateHashes ? 600 : 0, {
      appUrl: env.APP_URL,
      environment: env.ENVIRONMENT,
      path: "/api/auth/callback/",
    }),
    // Clear the redirect cookie after consuming it
    createCookieString("oauth_redirect", "", 0, {
      appUrl: env.APP_URL,
      environment: env.ENVIRONMENT,
      path: "/api/auth/callback/",
    }),
  ]);

  const consumed = await db
    .delete(verifications)
    .where(
      and(
        eq(verifications.type, "oauth_pkce"),
        eq(verifications.identifier, `oauth:${data.state}`),
        gte(verifications.expiresAt, new Date())
      )
    )
    .returning();

  if (consumed.length === 0) throw Errors.OAUTH_ERROR("Invalid or expired OAuth state");
  const oauthVerification = consumed[0];

  let codeVerifier: string;
  try {
    codeVerifier = await decryptVerifier(oauthVerification.value, env.AUTH_SECRET);
  } catch {
    throw Errors.OAUTH_ERROR("Failed to verify OAuth state");
  }

  const payload = await exchangeAndVerifyGoogleCode(
    data.code,
    codeVerifier,
    `${env.APP_URL}/api/auth/callback/google`,
    env
  );

  const normalized = normalizeEmail(payload.email);
  const existingAccount = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.providerId, "google"),
      eq(accounts.providerAccountId, payload.sub)
    ),
  });

  let userId: string;

  if (existingAccount) {
    userId = existingAccount.userId;
  } else {
    const existingUser = await db.query.users.findFirst({
      where: eq(users.normalizedEmail, normalized),
    });

    if (existingUser) {
      userId = existingUser.id;
      logInfo(
        `[OAuth] Linking Google account (sub=${payload.sub}) to existing user ${existingUser.id}`
      );
      try {
        await db.insert(accounts).values({
          id: generateId("ACCOUNT"),
          userId,
          providerId: "google",
          providerAccountId: payload.sub,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("UNIQUE")) throw err;
      }
    } else {
      userId = generateId("USER");
      const now = new Date();
      try {
        await db.batch([
          db.insert(users).values({
            id: userId,
            email: payload.email,
            normalizedEmail: normalized,
            name: sanitizeDisplayName(payload.name ?? ""),
            image: payload.picture ?? null,
            plan: "free",
            role: "user",
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(accounts).values({
            id: generateId("ACCOUNT"),
            userId,
            providerId: "google",
            providerAccountId: payload.sub,
          }),
        ]);
      } catch {
        const raceWinner = await db.query.users.findFirst({
          where: eq(users.normalizedEmail, normalized),
        });
        if (raceWinner) {
          userId = raceWinner.id;
          try {
            await db.insert(accounts).values({
              id: generateId("ACCOUNT"),
              userId,
              providerId: "google",
              providerAccountId: payload.sub,
            });
          } catch { /* already linked */ }
        } else {
          throw Errors.CONFIG_ERROR("Failed to create user account");
        }
      }
    }
  }

  const sessionToken = generateSessionToken();
  const sessionTokenHash = await hashSessionToken(sessionToken);
  const oauthNow = Date.now();
  const expiresAt = new Date(oauthNow + SESSION_EXPIRY_MS);
  const absoluteExpiresAt = new Date(oauthNow + SESSION_ABSOLUTE_EXPIRY_MS);

  await withD1Retry(() =>
    db.insert(sessions).values({
      id: generateId("SESSION"),
      tokenHash: sessionTokenHash,
      userId,
      expiresAt,
      absoluteExpiresAt,
      ipAddress: getClientIP(),
      userAgent: request.headers.get("User-Agent")?.slice(0, 500) ?? null,
    }),
  );

  await enforceSessionCap(db, userId);
  await rememberDevice(db, env, userId).catch(() => {});

  appendCookies([
    createCookieString("session", sessionToken, SESSION_EXPIRY_SECONDS, {
      appUrl: env.APP_URL,
      environment: env.ENVIRONMENT,
    }),
  ]);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  return { user: sanitizeUser(user!) };
}
