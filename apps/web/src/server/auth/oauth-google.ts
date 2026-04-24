import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createDb } from "@ossmeet/db";
import { users, accounts, verifications } from "@ossmeet/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { normalizeEmail, generateId, googleCallbackSchema } from "@ossmeet/shared";
import { getEnv, createCookieString, enforceIpRateLimit, appendCookies, requireAuth } from "./helpers";
import { Errors } from "@ossmeet/shared";
import { logInfo } from "@/lib/logger";
import type { Database } from "@ossmeet/db";
import {
  addOAuthStateHash,
  hasOAuthStateHash,
  removeOAuthStateHash,
} from "./oauth-state";

// ─── Shared OAuth helpers ─────────────────────────────────────────────

/**
 * Generate a PKCE code verifier/challenge, store the verifier in the DB keyed
 * as `${identifierPrefix}:${state}`, and bind the state to the browser session
 * via an HttpOnly cookie. Returns the state and code challenge for use in the
 * authorization URL.
 */
/**
 * Encrypt a string value using AES-256-GCM, keyed from AUTH_SECRET.
 * Returns base64(iv || ciphertext) for compact DB storage.
 * An attacker with only DB read access cannot decrypt without AUTH_SECRET.
 */
async function encryptVerifier(value: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  // Derive a 256-bit AES key from the server secret using SHA-256
  const rawKey = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  const aesKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc.encode(value));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a value encrypted by encryptVerifier.
 */
export async function decryptVerifier(encrypted: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const combined = new Uint8Array(atob(encrypted).split("").map((c) => c.charCodeAt(0)));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const rawKey = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  const aesKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
  return new TextDecoder().decode(plaintext);
}

async function initPkceFlow(
  db: Database,
  env: Env,
  identifierPrefix: string,
  cookieName: string
): Promise<{ state: string; codeChallenge: string }> {
  const encoder = new TextEncoder();
  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
  const identifier = `${identifierPrefix}:${state}`;

  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // Encrypt the code verifier before storage so a DB read alone cannot recover it.
  // The AUTH_SECRET acts as the encryption key — attackers without it cannot decrypt.
  const encryptedVerifier = await encryptVerifier(codeVerifier, env.AUTH_SECRET);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  await db.insert(verifications).values({
    id: crypto.randomUUID(),
    type: "oauth_pkce" as const,
    identifier,
    value: encryptedVerifier,
    expiresAt,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [verifications.type, verifications.identifier],
    set: { value: encryptedVerifier, expiresAt, updatedAt: now },
  });

  const stateHash = await crypto.subtle.digest("SHA-256", encoder.encode(state));
  const stateHashHex = Array.from(new Uint8Array(stateHash))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const request = getRequest();
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookieValue =
    cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? null;
  const nextCookieValue = addOAuthStateHash(cookieValue, stateHashHex);

  appendCookies([createCookieString(cookieName, nextCookieValue, 600, {
    appUrl: env.APP_URL,
    environment: env.ENVIRONMENT,
    path: "/api/auth/callback/",
  })]);

  return { state, codeChallenge };
}

type GoogleTokenPayload = {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  email_verified?: boolean | string;
  verified_email?: boolean | string;
};

/**
 * Exchange an authorization code for a Google ID token, verify it, and return
 * the validated user info payload.
 */
export async function exchangeAndVerifyGoogleCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  env: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string }
): Promise<GoogleTokenPayload> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw Errors.OAUTH_ERROR("Failed to exchange code for tokens");

  const tokens = (await tokenRes.json()) as { id_token: string };
  const tokenInfoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!tokenInfoRes.ok) throw Errors.OAUTH_ERROR("Failed to verify ID token");

  const payload = (await tokenInfoRes.json()) as GoogleTokenPayload & {
    iss: string; aud: string; exp: string;
  };

  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw Errors.OAUTH_ERROR("Invalid ID token issuer");
  }
  if (payload.aud !== env.GOOGLE_CLIENT_ID) throw Errors.OAUTH_ERROR("Invalid ID token audience");
  if (Number(payload.exp) < Math.floor(Date.now() / 1000)) throw Errors.OAUTH_ERROR("ID token expired");
  const emailVerified = payload.email_verified ?? payload.verified_email;
  if (emailVerified !== true && emailVerified !== "true") {
    throw Errors.OAUTH_ERROR("Email not verified by Google");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    email_verified: payload.email_verified,
    verified_email: payload.verified_email,
  };
}

/**
 * Get Google OAuth authorization URL with PKCE
 */
export const getGoogleAuthUrl = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => {
    const redirectTo = typeof raw === "object" && raw !== null && "redirectTo" in raw
      ? (raw as { redirectTo?: unknown }).redirectTo
      : undefined;
    return { redirectTo: typeof redirectTo === "string" ? redirectTo : undefined };
  })
  .handler(
  async ({ data }) => {
    const env = await getEnv();
    const db = createDb(env.DB);

    await enforceIpRateLimit(env, "oauth-init");

    const { state, codeChallenge } = await initPkceFlow(db, env, "oauth", "oauth_state");

    if (data.redirectTo) {
      appendCookies([createCookieString("oauth_redirect", data.redirectTo, 600, {
        appUrl: env.APP_URL,
        environment: env.ENVIRONMENT,
        path: "/api/auth/callback/",
      })]);
    }

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${env.APP_URL}/api/auth/callback/google`,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      access_type: "online",
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      state,
    };
  }
);

/**
 * Handle Google OAuth callback
 */
/**
 * Get Google OAuth URL for account linking (requires auth)
 */
export const getGoogleLinkUrl = createServerFn({ method: "GET" }).handler(
  async () => {
    const env = await getEnv();
    const db = createDb(env.DB);
    await requireAuth();

    await enforceIpRateLimit(env, "oauth-link-init");

    const { state, codeChallenge } = await initPkceFlow(db, env, "oauth-link", "oauth_link_state");

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${env.APP_URL}/api/auth/callback/google-link`,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      state,
    };
  }
);

/**
 * Link Google account to current user (called from callback)
 */
export const linkGoogleAccount = createServerFn({ method: "POST" })
  .inputValidator(googleCallbackSchema)
  .handler(async ({ data }) => {
    const request = getRequest();
    const env = await getEnv();
    const db = createDb(env.DB);
    const currentUser = await requireAuth();

    await enforceIpRateLimit(env, "oauth-link-callback");

    // Verify the OAuth state cookie matches the state parameter
    const cookie = request.headers.get("Cookie") ?? "";
    const stateCookieMatch = cookie.match(/(?:^|;\s*)oauth_link_state=([^;]+)/);
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

    // Remove only the consumed state so parallel tabs keep their own pending flows.
    const remainingStateHashes = removeOAuthStateHash(stateCookieValue, expectedHashHex);
    appendCookies([createCookieString("oauth_link_state", remainingStateHashes, remainingStateHashes ? 600 : 0, {
      appUrl: env.APP_URL,
      environment: env.ENVIRONMENT,
      path: "/api/auth/callback/",
    })]);

    const consumed = await db
      .delete(verifications)
      .where(
        and(
          eq(verifications.type, "oauth_pkce"),
          eq(verifications.identifier, `oauth-link:${data.state}`),
          gte(verifications.expiresAt, new Date())
        )
      )
      .returning();

    if (consumed.length === 0) throw Errors.OAUTH_ERROR("Invalid or expired OAuth state");
    const oauthVerification = consumed[0];

    // Decrypt the stored code verifier before sending it to Google
    let linkCodeVerifier: string;
    try {
      linkCodeVerifier = await decryptVerifier(oauthVerification.value, env.AUTH_SECRET);
    } catch {
      throw Errors.OAUTH_ERROR("Failed to verify OAuth state");
    }

    const payload = await exchangeAndVerifyGoogleCode(
      data.code,
      linkCodeVerifier,
      `${env.APP_URL}/api/auth/callback/google-link`,
      env
    );

    // Verify Google email matches current user's email
    const googleNormalized = normalizeEmail(payload.email);
    const dbUser = await db.query.users.findFirst({
      where: eq(users.id, currentUser.id),
      columns: { normalizedEmail: true },
    });
    if (!dbUser || googleNormalized !== dbUser.normalizedEmail) {
      throw Errors.VALIDATION("Google account email must match your account email.");
    }

    // Check if this Google account is already linked to another user
    const existingAccount = await db.query.accounts.findFirst({
      where: and(
        eq(accounts.providerId, "google"),
        eq(accounts.providerAccountId, payload.sub)
      ),
    });
    if (existingAccount) {
      if (existingAccount.userId === currentUser.id) {
        return { success: true, alreadyLinked: true };
      }
      throw Errors.VALIDATION("This Google account is already linked to another user.");
    }

    // Link the account
    await db.insert(accounts).values({
      id: generateId("ACCOUNT"),
      userId: currentUser.id,
      providerId: "google",
      providerAccountId: payload.sub,
    });

    logInfo(`[OAuth] Linked Google account (sub=${payload.sub}) to user ${currentUser.id}`);

    return { success: true };
  });

/**
 * Unlink Google account from current user
 */
export const unlinkGoogleAccount = createServerFn({ method: "POST" }).handler(
  async () => {
    const env = await getEnv();
    const db = createDb(env.DB);
    const currentUser = await requireAuth();

    await enforceIpRateLimit(env, "oauth-unlink");

    // OTP login is always available via email, so unlinking Google is safe
    const deleted = await db
      .delete(accounts)
      .where(
        and(
          eq(accounts.userId, currentUser.id),
          eq(accounts.providerId, "google")
        )
      )
      .returning();

    if (deleted.length === 0) {
      throw Errors.VALIDATION("No Google account linked.");
    }

    logInfo(`[OAuth] Unlinked Google account from user ${currentUser.id}`);

    return { success: true };
  }
);

/**
 * Get linked accounts for current user
 */
export const getLinkedAccounts = createServerFn({ method: "GET" }).handler(
  async () => {
    const env = await getEnv();
    const db = createDb(env.DB);
    const currentUser = await requireAuth();

    const linkedAccounts = await db.query.accounts.findMany({
      where: eq(accounts.userId, currentUser.id),
      columns: {
        providerId: true,
        linkedAt: true,
      },
    });

    return linkedAccounts.map((acc) => ({
      providerId: acc.providerId,
      linkedAt: acc.linkedAt,
    }));
  }
);
