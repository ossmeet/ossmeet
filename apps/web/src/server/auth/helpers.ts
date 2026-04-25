import { getRequest, setResponseHeader, getResponseHeader } from "@tanstack/react-start/server";
import { createDb, type Database } from "@ossmeet/db";
import { sessions, meetingParticipants, devices, users } from "@ossmeet/db/schema";
import { eq, or, inArray, asc, and, isNull, gte, desc } from "drizzle-orm";
import {
  CURRENT_MEETING_PARTICIPANT_STATUSES,
  Errors,
  AppError,
} from "@ossmeet/shared";
import {
  SESSION_EXPIRY_MS,
  SESSION_REFRESH_THRESHOLD_MS,
  generateId,
} from "@ossmeet/shared";
import { hashSessionToken, generateSessionToken, verifyGuestSecret } from "@/lib/auth/crypto";
import { getRunChanges, withD1Retry } from "@/lib/db-utils";
import { logWarn, logError } from "@/lib/logger";
import type { User } from "@ossmeet/db/schema";
import type { PublicUser } from "@ossmeet/shared";

export type { PublicUser };

export function sanitizeUser(user: User | null): PublicUser | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    plan: user.plan,
    role: user.role,
    subscriptionStatus: user.subscriptionStatus ?? null,
  };
}

// ─── Cookie helpers ──────────────────────────────────────────────────

type CookieOptions = { appUrl?: string; environment?: string };
const REMEMBERED_DEVICE_COOKIE = "ossmeet_device";
const REMEMBERED_DEVICE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60; // 180 days
const MAX_DEVICES_PER_USER = 8;

export function createCookieString(
  name: string,
  value: string,
  maxAge: number,
  options?: CookieOptions & { path?: string }
): string {
  const isLocalhost =
    options?.appUrl?.startsWith("http://localhost") ||
    options?.appUrl?.startsWith("http://127.0.0.1");
  const isDevByEnv = options?.environment === "development";
  const isDev = isDevByEnv || Boolean(isLocalhost);
  const secureFlag = isDev ? "" : "Secure; ";
  const cookiePath = options?.path ?? "/";

  // Use host-only cookies by default (omit Domain=) to avoid setting overly-broad
  // domains on public suffixes like workers.dev, pages.dev, or co.uk.
  // Host-only cookies are scoped to the exact hostname and are strictly more secure.
  // Only set Domain= when an explicit COOKIE_DOMAIN env var is provided.
  let domainFlag = "";
  if (!isDev) {
    const explicitDomain = (options as (CookieOptions & { cookieDomain?: string }) | undefined)?.cookieDomain;
    if (explicitDomain) {
      domainFlag = `Domain=.${explicitDomain}; `;
    }
  }

  return `${name}=${value}; Path=${cookiePath}; HttpOnly; ${secureFlag}${domainFlag}SameSite=Lax; Max-Age=${maxAge}`;
}

/**
 * Append Set-Cookie values without overwriting any previously set cookies.
 * Uses a more robust approach to handle concurrent cookie operations.
 * (e.g. session refresh cookies set by resolveSession).
 */
export function appendCookies(cookies: string[]): void {
  if (cookies.length === 0) return;
  const existing = getResponseHeader("Set-Cookie");
  // Normalize existing to array, ensuring we handle all cases
  const prev: string[] = !existing 
    ? [] 
    : Array.isArray(existing) 
      ? existing 
      : [existing];
  // Create new array to avoid mutation issues
  const combined = [...prev, ...cookies];
  setResponseHeader("Set-Cookie", combined);
}

// ─── Client IP ───────────────────────────────────────────────────────

// In production, CF-Connecting-IP is authoritative (set by Cloudflare).
// X-Forwarded-For is only used as fallback in development — it's trivially spoofable
// without a trusted proxy. Rate limiting in dev uses an in-memory fallback anyway.
export function getClientIP(): string {
  try {
    const request = getRequest();
    // CF-Connecting-IP is authoritative in production (set by Cloudflare)
    const cfIP = request.headers.get("CF-Connecting-IP");
    if (cfIP) return cfIP;
    // Only trust X-Forwarded-For in development to prevent IP spoofing
    // In production without CF-Connecting-IP, return "unknown" to fail-safe
    const isDev = typeof globalThis !== "undefined" && (globalThis as { __ENVIRONMENT?: string }).__ENVIRONMENT === "development";
    if (isDev) {
      const forwarded = request.headers.get("X-Forwarded-For");
      if (forwarded) return forwarded.split(",")[0].trim();
      const realIP = request.headers.get("X-Real-IP");
      if (realIP) return realIP;
    }
    // Production without CF-Connecting-IP shouldn't happen behind Cloudflare
    if (!isDev) {
      logWarn("[getClientIP] CF-Connecting-IP missing in non-dev environment — rate limiting may be unreliable");
    }
    // Use a request fingerprint with more header entropy to reduce collisions
    const ua = request.headers.get("User-Agent") ?? "";
    const accept = request.headers.get("Accept-Language") ?? "";
    const acceptEnc = request.headers.get("Accept-Encoding") ?? "";
    return `fp:${ua.slice(0, 80)}:${accept.slice(0, 40)}:${acceptEnc.slice(0, 20)}`;
  } catch {
    return "unknown";
  }
}

// ─── Environment ─────────────────────────────────────────────────────

export async function getEnv(): Promise<Env> {
  try {
    const request = getRequest();
    const cloudflare = (request as unknown as { __cloudflare?: { env?: Env } }).__cloudflare;
    if (cloudflare?.env) return cloudflare.env;
  } catch {}

  try {
    const { env: cfEnv } = await import("cloudflare:workers");
    return cfEnv as Env;
  } catch {
    throw Errors.CONFIG_ERROR("Environment bindings not available");
  }
}

/**
 * Extract Cloudflare env bindings from a raw Request object.
 * Used by API route handlers that receive the request directly
 * (not via server functions which use getEnv() + getRequest()).
 * Returns undefined if env is unavailable rather than throwing.
 */
export async function getEnvFromRequest(request: Request): Promise<Env | undefined> {
  const cloudflare = (request as unknown as { __cloudflare?: { env?: Env } }).__cloudflare;
  if (cloudflare?.env) return cloudflare.env;
  try {
    const { env: cfEnv } = await import("cloudflare:workers");
    return cfEnv as Env;
  } catch {
    return undefined;
  }
}

// ─── Session cookie parsing ──────────────────────────────────────────

const COOKIE_MAX_TOKENS = 100;

export function getSessionIdsFromCookie(cookie: string | null): string[] {
  if (!cookie) return [];
  const prefix = "session=";
  const values: string[] = [];
  for (const part of cookie.split(";")) {
    if (values.length >= COOKIE_MAX_TOKENS) break;
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const rawValue = trimmed.slice(prefix.length);
    if (!rawValue) continue;
    try {
      values.push(decodeURIComponent(rawValue));
    } catch {
      values.push(rawValue);
    }
  }
  return values;
}

export function getCookieValue(cookie: string | null, name: string): string | null {
  if (!cookie) return null;
  const prefix = `${name}=`;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const rawValue = trimmed.slice(prefix.length);
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

export function getGuestCookieSecretFromCookie(
  cookie: string | null,
  participantId: string,
): string | null {
  return getCookieValue(cookie, guestCookieName(participantId));
}

// ─── In-memory rate limiter fallback ─────────────────────────────────

interface MemoryLimitEntry {
  count: number;
  resetAt: number;
}
const _memoryLimits = new Map<string, MemoryLimitEntry>();
let _lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_MEMORY_LIMIT_ENTRIES = 10_000;

function memoryLimit(key: string, limit: number, periodMs: number): boolean {
  const now = Date.now();
  const entry = _memoryLimits.get(key);
  if (!entry || entry.resetAt < now) {
    // Evict expired entries before adding new ones if at capacity
    if (_memoryLimits.size >= MAX_MEMORY_LIMIT_ENTRIES) {
      for (const [k, v] of _memoryLimits) {
        if (v.resetAt < now) _memoryLimits.delete(k);
      }
      // If still at capacity after expiry sweep, evict oldest entries (LRU)
      if (_memoryLimits.size >= MAX_MEMORY_LIMIT_ENTRIES) {
        const toEvict = _memoryLimits.size - MAX_MEMORY_LIMIT_ENTRIES + 1;
        let evicted = 0;
        for (const k of _memoryLimits.keys()) {
          if (evicted >= toEvict) break;
          _memoryLimits.delete(k);
          evicted++;
        }
      }
      _lastCleanup = now;
    }
    _memoryLimits.set(key, { count: 1, resetAt: now + periodMs });
  } else if (entry.count >= limit) {
    return false;
  } else {
    entry.count++;
  }
  // Periodic cleanup of expired entries
  if (now - _lastCleanup > CLEANUP_INTERVAL_MS && _memoryLimits.size > 0) {
    _lastCleanup = now;
    for (const [k, v] of _memoryLimits) {
      if (v.resetAt < now) _memoryLimits.delete(k);
    }
  }
  return true;
}

// ─── Rate limiting ───────────────────────────────────────────────────

export async function enforceRateLimit(
  env: Env,
  key: string,
  useAuthLimiter = false
): Promise<void> {
  const limiter = useAuthLimiter ? env.AUTH_RATE_LIMITER : env.RATE_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key });
    if (!success) throw Errors.RATE_LIMITED();
    return;
  }

  if (env.ENVIRONMENT === "production") {
    logError("[RateLimit] Cloudflare binding unavailable in production; rejecting request.");
    throw Errors.CONFIG_ERROR("Rate limiter binding not configured");
  }

  logWarn(
    `[RateLimit] Cloudflare binding not configured; using in-memory fallback for key: ${key}`
  );

  const limit = useAuthLimiter ? 60 : 100;
  if (!memoryLimit(key, limit, 60_000)) {
    throw Errors.RATE_LIMITED();
  }
}

export async function enforceIpRateLimit(
  env: Env,
  action: string
): Promise<void> {
  const ip = getClientIP();
  await enforceRateLimit(env, `auth-ip:${action}:${ip}`, true);
}

// ─── Disposable email check ──────────────────────────────────────────────

const KNOWN_DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  // Temp-mail providers (including current observed bypass)
  "pmdeal.com",
  "temp-mail.org",
  "tempmail.plus",
  "mail.tm",
  "mailinator.com",
  "guerrillamail.com",
  "sharklasers.com",
  "10minutemail.com",
  "yopmail.com",
]);

function getEmailDomain(normalizedEmail: string): string | null {
  const atIndex = normalizedEmail.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) return null;
  return normalizedEmail.slice(atIndex + 1).trim().toLowerCase();
}

function isKnownDisposableDomain(domain: string): boolean {
  if (KNOWN_DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  for (const candidate of KNOWN_DISPOSABLE_EMAIL_DOMAINS) {
    if (domain.endsWith(`.${candidate}`)) return true;
  }
  return false;
}

/**
 * Check if an email is a temporary/disposable email using the debounce.io API.
 * Uses a 2-second timeout with fail-open (allows email if API unreachable).
 * @throws {AppError} with TEMPORARY_EMAIL code if email is disposable
 */
export async function checkDisposableEmail(normalizedEmail: string): Promise<void> {
  const domain = getEmailDomain(normalizedEmail);
  if (domain && isKnownDisposableDomain(domain)) {
    throw Errors.TEMPORARY_EMAIL();
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`https://disposable.debounce.io/?email=${encodeURIComponent(normalizedEmail)}`, {
      signal: controller.signal,
      // Add User-Agent to be good HTTP citizens
      headers: { "User-Agent": "OSSMeet/1.0" },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const body = (await response.json()) as { disposable?: string };
      if (body.disposable === "true") {
        throw Errors.TEMPORARY_EMAIL();
      }
    }
  } catch (err: unknown) {
    // If it's already our TEMPORARY_EMAIL error, re-throw it
    if (err instanceof Error && "code" in err && err.code === "TEMPORARY_EMAIL") {
      throw err;
    }
    // Timeout or network error — fail-open (don't block signup), but log so
    // we can detect when the disposable-email provider is degraded.
    logWarn("[auth] Disposable email API check failed; proceeding with signup", err);
  }
}

// ─── Session resolution ──────────────────────────────────────────────

type SessionWithUser = typeof sessions.$inferSelect & { user: User };
type SessionWithPublicUser = Omit<SessionWithUser, "user"> & {
  user: PublicUser;
};

type CachedSession = {
  session: SessionWithPublicUser | null;
  user: PublicUser | null;
};

const sessionCache = new WeakMap<Request, Promise<CachedSession>>();

// Extend session expiry and rotate token when approaching threshold (sliding window).
// Stores old token hash in previousTokenHash so clients that missed the rotation
// cookie can still authenticate on the next request.
export async function maybeRefreshSession(
  session: SessionWithUser,
  env: Env,
  db: Database,
  matchedViaPrevious: boolean
): Promise<{ session: SessionWithUser; setCookie: string | null }> {
  const now = Date.now();
  const absoluteExpiresAtMs = session.absoluteExpiresAt.getTime();
  if (absoluteExpiresAtMs <= now) {
    return { session, setCookie: null };
  }
  const expiresAtMs = session.expiresAt.getTime();
  if (!matchedViaPrevious && expiresAtMs - now > SESSION_REFRESH_THRESHOLD_MS) {
    return { session, setCookie: null };
  }

  const latest = session;

  // When the client presented the *previous* token (i.e. another concurrent
  // request already rotated this session), do NOT rotate again.
  //
  // Rotating here would overwrite previousTokenHash with the newer token the
  // OTHER request received, evicting the token this client is actually using
  // from the lookup chain. If the refreshed Set-Cookie header doesn't land on
  // this client (e.g. background fetch, or response is discarded), their next
  // request with the same old token would fail auth.
  //
  // Instead, just extend the absolute-window's sliding expiry on the existing
  // row without touching token hashes. The canonical tokenHash (held by the
  // other request) remains authoritative; this client's cookie keeps working
  // via the previousTokenHash chain until its own next rotation event.
  if (matchedViaPrevious) {
    const newExpiresAt = new Date(Math.min(Date.now() + SESSION_EXPIRY_MS, absoluteExpiresAtMs));
    try {
      await withD1Retry(() =>
        db
          .update(sessions)
          .set({ expiresAt: newExpiresAt, lastSeenAt: new Date() })
          .where(eq(sessions.id, latest.id)),
      );
      latest.expiresAt = newExpiresAt;
    } catch (err) {
      if (err instanceof AppError) throw err;
    }
    return { session: latest, setCookie: null };
  }

  const ROTATION_CAS_MAX_RETRIES = 3;
  const sleepWithJitter = async (attempt: number) => {
    const backoffMs = Math.min(120, 20 * 2 ** attempt);
    const jitterMs = Math.floor(Math.random() * 25);
    await new Promise((resolve) => setTimeout(resolve, backoffMs + jitterMs));
  };

  for (let attempt = 0; attempt < ROTATION_CAS_MAX_RETRIES; attempt++) {
    const newToken = generateSessionToken();
    const newTokenHash = await hashSessionToken(newToken);
    const newExpiresAt = new Date(Math.min(Date.now() + SESSION_EXPIRY_MS, absoluteExpiresAtMs));
    const currentVersion = latest.rotationVersion ?? 0;

    const updatePayload = {
      previousTokenHash: latest.tokenHash,
      tokenHash: newTokenHash,
      rotationVersion: currentVersion + 1,
      expiresAt: newExpiresAt,
      lastSeenAt: new Date(),
    };

    try {
      const result = await withD1Retry(() =>
        db
          .update(sessions)
          .set(updatePayload)
          .where(and(
            eq(sessions.id, latest.id),
            eq(sessions.rotationVersion, currentVersion)
          )),
      );

      const changes = getRunChanges(result);
      if (changes > 0) {
        latest.previousTokenHash = latest.tokenHash;
        latest.tokenHash = newTokenHash;
        latest.rotationVersion = currentVersion + 1;
        latest.expiresAt = newExpiresAt;
        const cookieMaxAgeSeconds = Math.max(
          1,
          Math.floor((newExpiresAt.getTime() - Date.now()) / 1000),
        );
        const cookieValue = createCookieString(
          "session",
          newToken,
          cookieMaxAgeSeconds,
          { appUrl: env.APP_URL, environment: env.ENVIRONMENT }
        );
        return { session: latest, setCookie: cookieValue };
      }
      // CAS mismatch means another request already rotated this session.
      // Do not issue a new cookie in this request — the client's current
      // token still resolves via the now-updated previousTokenHash chain.
      return { session: latest, setCookie: null };
    } catch (err) {
      if (err instanceof AppError) throw err;
    }

    if (attempt < ROTATION_CAS_MAX_RETRIES - 1) {
      await sleepWithJitter(attempt);
    }
  }

  return { session: latest, setCookie: null };
}

async function resolveSession(request: Request): Promise<CachedSession> {
  const env = await getEnv();
  const db = createDb(env.DB);
  const cookie = request.headers.get("Cookie");
  // Limit to 5 unique tokens to bound CPU and D1 query cost.
  // A legitimate browser sends at most 1-2 session cookies; more than 5 distinct
  // values indicates malformed or crafted cookies.
  const sessionTokens = Array.from(new Set(getSessionIdsFromCookie(cookie))).slice(0, 5);
  if (sessionTokens.length === 0) {
    logWarn("[session] No session tokens found in cookie header");
    return { session: null, user: null };
  }

  // Hash all tokens in parallel, then batch-query
  const tokenHashes = await Promise.all(
    sessionTokens.map((t) => hashSessionToken(t))
  );

  // Check both tokenHash and previousTokenHash in a single round-trip
  const candidates = await db.query.sessions.findMany({
    where: or(
      inArray(sessions.tokenHash, tokenHashes),
      inArray(sessions.previousTokenHash, tokenHashes),
    ),
    with: { user: true },
  });

  const candidatesByTokenHash = new Map<string, SessionWithUser>();
  const candidatesByPreviousTokenHash = new Map<string, SessionWithUser>();
  for (const candidate of candidates) {
    candidatesByTokenHash.set(candidate.tokenHash, candidate);
    if (candidate.previousTokenHash) {
      candidatesByPreviousTokenHash.set(candidate.previousTokenHash, candidate);
    }
  }

  const now = new Date();
  // Prefer the last (most recent) token from the cookie
  let matchedSession: SessionWithUser | null = null;
  let matchedToken: string | null = null;
  let matchedViaPrevious = false;
  for (let i = sessionTokens.length - 1; i >= 0; i--) {
    const hash = tokenHashes[i];
    // Check current tokenHash first
    const candidate = candidatesByTokenHash.get(hash);
    if (candidate && candidate.expiresAt > now && candidate.absoluteExpiresAt > now) {
      matchedSession = candidate;
      matchedToken = sessionTokens[i];
      break;
    }
    // Fall back to previousTokenHash (client missed rotation cookie)
    const prevCandidate = candidatesByPreviousTokenHash.get(hash);
    if (prevCandidate && prevCandidate.expiresAt > now && prevCandidate.absoluteExpiresAt > now) {
      matchedSession = prevCandidate;
      matchedToken = sessionTokens[i];
      matchedViaPrevious = true;
      break;
    }
  }
  if (!matchedSession || !matchedToken) {
    logWarn("[session] No valid session found");
    return { session: null, user: null };
  }

  const { session: refreshed, setCookie } = await maybeRefreshSession(
    matchedSession,
    env,
    db,
    matchedViaPrevious
  );
  if (setCookie) {
    // Use array form to append rather than overwrite — prevents a later
    // setResponseHeader("Set-Cookie", [...]) from wiping this refresh cookie
    const existing = getResponseHeader("Set-Cookie");
    const existingCookies = existing
      ? (Array.isArray(existing) ? existing : [existing])
      : [];
    setResponseHeader("Set-Cookie", [...existingCookies, setCookie]);
  }

  const sanitizedUser = sanitizeUser(refreshed.user)!;
  return {
    session: { ...refreshed, user: sanitizedUser },
    user: sanitizedUser,
  };
}

async function getCachedSession(request: Request): Promise<CachedSession> {
  const cached = sessionCache.get(request);
  if (cached) return cached;
  const promise = resolveSession(request);
  sessionCache.set(request, promise);
  return promise;
}

export async function getAuthenticatedUser(): Promise<PublicUser | null> {
  try {
    const request = getRequest();
    const cached = await getCachedSession(request);
    return cached.user;
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(): Promise<SessionWithPublicUser | null> {
  // Let errors propagate so the client can distinguish "no session" (null)
  // from "server error" (thrown). Swallowing errors here caused transient
  // DB failures to cache null in TanStack Query, logging users out.
  const request = getRequest();
  const cached = await getCachedSession(request);
  return cached.session;
}

export async function requireAuth(): Promise<PublicUser> {
  // Use session resolution directly so infrastructure failures propagate
  // as server errors instead of being collapsed into UNAUTHORIZED.
  const session = await getSessionFromRequest();
  if (!session?.user) throw Errors.UNAUTHORIZED();
  return session.user;
}

/**
 * Verify a session from a raw Request object without TanStack Start context.
 * Use this in raw API route handlers (server.handlers.GET/POST) where
 * getRequest() is not available.
 * Returns the session's userId if valid, null otherwise.
 */
export async function verifySessionFromRawRequest(
  request: Request,
  env: Env,
): Promise<{ userId: string } | null> {
  const cookie = request.headers.get("Cookie");
  // Dedupe and cap at 5, consistent with resolveSession, to bound CPU and D1 cost.
  const tokens = Array.from(new Set(getSessionIdsFromCookie(cookie))).slice(0, 5);
  if (tokens.length === 0) return null;

  const db = createDb(env.DB);
  const hashes = await Promise.all(tokens.map((t) => hashSessionToken(t)));

  // Batch-query all candidate sessions in a single round-trip (aligns with resolveSession)
  const candidates = await db.query.sessions.findMany({
    where: or(
      inArray(sessions.tokenHash, hashes),
      inArray(sessions.previousTokenHash, hashes),
    ),
    columns: {
      tokenHash: true,
      previousTokenHash: true,
      expiresAt: true,
      absoluteExpiresAt: true,
      userId: true,
    },
  });

  const now = new Date();
  const byTokenHash = new Map(candidates.map((c) => [c.tokenHash, c]));
  const byPrevHash = new Map(
    candidates.filter((c) => c.previousTokenHash).map((c) => [c.previousTokenHash!, c])
  );

  // Prefer the last (most recent) token from the cookie
  for (let i = tokens.length - 1; i >= 0; i--) {
    const hash = hashes[i];
    const session = byTokenHash.get(hash) ?? byPrevHash.get(hash);
    if (session && session.expiresAt > now && session.absoluteExpiresAt > now) {
      return { userId: session.userId };
    }
  }
  return null;
}

async function enforceDeviceCap(db: Database, userId: string): Promise<void> {
  const userDevices = await db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.userId, userId))
    .orderBy(desc(devices.lastSeenAt), desc(devices.createdAt));
  if (userDevices.length > MAX_DEVICES_PER_USER) {
    const toDelete = userDevices.slice(MAX_DEVICES_PER_USER).map((d) => d.id);
    await db.delete(devices).where(inArray(devices.id, toDelete));
  }
}

export async function rememberDevice(
  db: Database,
  env: Env,
  userId: string,
): Promise<void> {
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REMEMBERED_DEVICE_MAX_AGE_SECONDS * 1000);
  const request = getRequest();
  const ua = request.headers.get("User-Agent")?.slice(0, 200) ?? null;

  await withD1Retry(() =>
    db.insert(devices).values({
      id: generateId("DEVICE"),
      userId,
      tokenHash,
      label: ua,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    }),
  );

  await enforceDeviceCap(db, userId);

  appendCookies([
    createCookieString(REMEMBERED_DEVICE_COOKIE, token, REMEMBERED_DEVICE_MAX_AGE_SECONDS, {
      appUrl: env.APP_URL,
      environment: env.ENVIRONMENT,
    }),
  ]);
}

export async function getRememberedUserFromRequest(): Promise<PublicUser | null> {
  const request = getRequest();
  const env = await getEnv();
  const db = createDb(env.DB);
  const cookie = request.headers.get("Cookie");
  const rawToken = getCookieValue(cookie, REMEMBERED_DEVICE_COOKIE);
  if (!rawToken) return null;

  const tokenHash = await hashSessionToken(rawToken);
  const now = new Date();
  const row = await db
    .select({
      id: devices.id,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      userImage: users.image,
      userPlan: users.plan,
      userRole: users.role,
    })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(and(eq(devices.tokenHash, tokenHash), gte(devices.expiresAt, now)))
    .limit(1);

  if (row.length === 0) return null;

  const nextExpiry = new Date(now.getTime() + REMEMBERED_DEVICE_MAX_AGE_SECONDS * 1000);
  await db
    .update(devices)
    .set({ lastSeenAt: now, expiresAt: nextExpiry })
    .where(eq(devices.id, row[0].id));

  appendCookies([
    createCookieString(REMEMBERED_DEVICE_COOKIE, rawToken, REMEMBERED_DEVICE_MAX_AGE_SECONDS, {
      appUrl: env.APP_URL,
      environment: env.ENVIRONMENT,
    }),
  ]);

  return {
    id: row[0].userId,
    name: row[0].userName,
    email: row[0].userEmail,
    image: row[0].userImage,
    plan: row[0].userPlan,
    role: row[0].userRole,
    subscriptionStatus: null,
  };
}

// ─── Guest cookie helpers ────────────────────────────────────────────

const GUEST_COOKIE_MAX_AGE = 8 * 60 * 60; // 8 hours — covers reasonable meeting durations

/** Cookie name for a guest participant's secret. */
export function guestCookieName(participantId: string): string {
  return `ossmeet_guest_${participantId}`;
}

/**
 * Read the raw guest secret from the HttpOnly cookie set at join time.
 * Returns null if the cookie is absent or the context is unavailable.
 */
export function getGuestCookieSecret(participantId: string): string | null {
  try {
    const request = getRequest();
    return getGuestCookieSecretFromCookie(request.headers.get("Cookie"), participantId);
  } catch {
    return null;
  }
}

/**
 * Set an HttpOnly cookie containing the guest's raw secret.
 * Call this right after inserting the guest participant row.
 */
export function setGuestCookie(
  participantId: string,
  rawSecret: string,
  options?: CookieOptions
): void {
  const cookieStr = createCookieString(
    guestCookieName(participantId),
    rawSecret,
    GUEST_COOKIE_MAX_AGE,
    options
  );
  appendCookies([cookieStr]);
}

/**
 * Clear the guest cookie when the participant leaves.
 */
export function clearGuestCookie(
  participantId: string,
  options?: CookieOptions
): void {
  const cookieStr = createCookieString(
    guestCookieName(participantId),
    "",
    0,
    options
  );
  appendCookies([cookieStr]);
}

/**
 * Verify that the caller owns a guest participant row.
 * Reads the secret from the HttpOnly cookie set at join time, looks up the
 * participant, and does a timing-safe comparison against the stored hash.
 * Throws UNAUTHORIZED if the cookie is absent, FORBIDDEN if the participant
 * is not found or the secret does not match.
 * Returns the full participant row on success.
 */
export async function verifyGuestParticipant(
  db: Database,
  meetingId: string,
  participantId: string,
) {
  const guestSecret = getGuestCookieSecret(participantId);
  return verifyGuestParticipantBySecret(db, meetingId, participantId, guestSecret);
}

export async function verifyGuestParticipantBySecret(
  db: Database,
  meetingId: string,
  participantId: string,
  guestSecret: string | null,
) {
  if (!guestSecret) throw Errors.UNAUTHORIZED();

  const participant = await db.query.meetingParticipants.findFirst({
    where: and(
      eq(meetingParticipants.id, participantId),
      eq(meetingParticipants.sessionId, meetingId),
      inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
      isNull(meetingParticipants.userId),
    ),
  });

  if (!participant?.guestSecret) throw Errors.FORBIDDEN();
  if (!await verifyGuestSecret(participant.guestSecret, guestSecret)) throw Errors.FORBIDDEN();

  return participant;
}

// ─── Session cap enforcement ────────────────────────────────────────

const MAX_SESSIONS = 10;

/**
 * Shared session cap enforcement helper.
 * Evicts oldest sessions when over limit using a single batch delete.
 */
export async function enforceSessionCap(db: Database, userId: string): Promise<void> {
  // Fetch sessions oldest-first to correctly identify which to evict.
  // Sanity LIMIT of 100 prevents pathological cases (e.g. compromised account);
  // expired sessions are cleaned by the scheduled cleanup job, so this bound
  // should always be sufficient for legitimate users.
  const userSessions = await db.select({ id: sessions.id }).from(sessions)
    .where(eq(sessions.userId, userId)).orderBy(asc(sessions.createdAt)).limit(100);
  if (userSessions.length > MAX_SESSIONS) {
    const toDelete = userSessions.slice(0, userSessions.length - MAX_SESSIONS);
    const idsToDelete = toDelete.map((s) => s.id);
    await db.delete(sessions).where(inArray(sessions.id, idsToDelete));
  }
}
