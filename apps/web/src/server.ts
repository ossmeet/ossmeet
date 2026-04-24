import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { addSecurityHeaders, buildMeetRouteCsp } from "./lib/security-headers";
import { validateCsrfOrigin } from "./lib/origin-validation";
import { logWarn, logError } from "./lib/logger";
import { getOrCreateRequestId, withRequestId, withRequestIdHeader } from "./lib/request-id";

const handler = createStartHandler(defaultStreamHandler);

function isLocalhostUrl(appUrl?: string): boolean {
  if (!appUrl) return false;
  try {
    const hostname = new URL(appUrl).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function isProductionEnv(env?: Env): boolean {
  if (!env) return false;
  if (isLocalhostUrl(env.APP_URL)) return false;
  if (env.ENVIRONMENT) return env.ENVIRONMENT === "production";
  return Boolean(env.APP_URL && !isLocalhostUrl(env.APP_URL));
}

function validateProductionConfig(env?: Env): Response | null {
  if (!isProductionEnv(env)) return null;
  if (!env?.APP_URL) {
    return new Response("Server misconfiguration: APP_URL is required in production", { status: 500 });
  }
  try {
    const url = new URL(env.APP_URL);
    if (url.protocol !== "https:") {
      return new Response("Server misconfiguration: APP_URL must be https in production", { status: 500 });
    }
  } catch {
    return new Response("Server misconfiguration: APP_URL is invalid in production", { status: 500 });
  }
  return null;
}

function isDevelopment(env?: Env, _requestUrl?: URL): boolean {
  // Do NOT trust requestUrl hostname — an attacker can send Host: localhost
  // to production, bypassing HSTS and CSP. Rely solely on env config.
  if (isLocalhostUrl(env?.APP_URL)) return true;
  if (env?.ENVIRONMENT) return env.ENVIRONMENT === "development";
  return false;
}

// Matches short meeting URLs: /abc-defg-hij
const MEETING_CODE_RE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/.*)?$/;

function isMeetRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/recorder") ||
    MEETING_CODE_RE.test(pathname)
  );
}

function isMeetingCodeUrl(pathname: string): boolean {
  return MEETING_CODE_RE.test(pathname);
}

function isSpaShellRoute(pathname: string): boolean {
  // Meeting code URLs are intentionally excluded: the shell is a single static
  // file built with a generic " $code __spa" match ID, which doesn't match the
  // actual URL's params. React detects the hydration mismatch, discards the
  // server DOM (including the loading spinner), and briefly shows a blank page
  // while re-rendering client-side. The SSR path renders the pending component
  // with the correct match ID, so hydration is seamless.
  return (
    pathname === "/" ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/spaces") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/recorder") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/verify") ||
    pathname.startsWith("/invite")
  );
}

function getMeetRouteCsp(pathname: string, env?: EnvWithAssets, isDevRequest = false): string | undefined {
  // In development, keep the broader localhost-friendly CSP. The production
  // meet-route CSP upgrades insecure requests and only whitelists https/wss
  // backends, which breaks local meeting routes served from http://localhost.
  if (isDevRequest || !isMeetRoute(pathname)) return undefined;

  return buildMeetRouteCsp({
    appUrl: env?.APP_URL,
    livekitUrl: env?.LIVEKIT_URL,
    whiteboardUrl: env?.WHITEBOARD_URL,
  });
}

// Authenticated routes that should receive the SPA shell instead of SSR
const AUTHENTICATED_PREFIXES = [
  "/dashboard",
  "/spaces",
  "/settings",
] as const;

function isAuthenticatedRoute(pathname: string): boolean {
  if (AUTHENTICATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  )) return true;
  return MEETING_CODE_RE.test(pathname);
}

type EnvWithAssets = Env & {
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
};

type RequestWithCloudflareContext = Request & {
  __cloudflare?: {
    env?: Env;
    ctx?: unknown;
  };
};

function attachCloudflareContext(
  request: Request,
  env?: EnvWithAssets,
  ctx?: unknown,
): RequestWithCloudflareContext {
  const requestWithContext = request as RequestWithCloudflareContext;
  requestWithContext.__cloudflare = {
    env: env as Env | undefined,
    ctx,
  };
  return requestWithContext;
}

// ─── Public HTML caching ──────────────────────────────────────────────────────
//
// Public pages (landing, /terms, /privacy, etc.) are SSR-rendered by the Worker
// then cached in Cloudflare's Cache API keyed on URL + Accept-Encoding.
// This bypasses repeated SSR work and the downstream D1 session query for
// unauthenticated visitors — cutting TTFB from ~400 ms to ~5 ms on cache hits.
//
// TTL: 10 minutes (s-maxage matches the Cache API entry lifetime below).
// This is intentionally short: the landing page embeds no user data, but content
// like plan limits or feature flags could change after a deploy.
const PUBLIC_HTML_CACHE_TTL = 600; // seconds
const PUBLIC_HTML_CACHE_NAME = "public-html-v2";

async function getPublicCache(): Promise<Cache | null> {
  try {
    // caches.default is only available in the Cloudflare Workers runtime
    if (typeof caches === "undefined") return null;
    return await (caches as any).open(PUBLIC_HTML_CACHE_NAME);
  } catch {
    return null;
  }
}

async function getMeetingChunks(env?: EnvWithAssets): Promise<string[]> {
  if (!env?.ASSETS) return [];

  try {
    const res = await env.ASSETS.fetch(new URL("meeting-chunks.json", "https://placeholder").toString());
    if (res.ok) {
      const manifest = (await res.json()) as { meetingChunks?: string[] };
      return manifest.meetingChunks ?? [];
    }
  } catch {
    // Manifest may not exist in development — non-critical
  }
  return [];
}

const SAFE_CHUNK_RE = /^\/assets\/[a-zA-Z0-9._-]+\.js$/;

/**
 * Inject `<link rel="modulepreload">` tags for meeting chunks into HTML head.
 * Uses HTMLRewriter so the response body is streamed rather than buffered.
 */
async function injectMeetingPreloads(
  response: Response,
  env?: EnvWithAssets,
): Promise<Response> {
  const chunks = await getMeetingChunks(env);
  if (chunks.length === 0) return response;

  const preloadTags = chunks
    .filter((chunk) => SAFE_CHUNK_RE.test(chunk))
    .map((chunk) => `<link rel="modulepreload" href="${chunk}"/>`)
    .join("");

  if (!preloadTags) return response;

  return new HTMLRewriter()
    .on("head", {
      element(el) {
        el.append(preloadTags, { html: true });
      },
    })
    .transform(response);
}

async function getSpaShellHtml(env?: EnvWithAssets): Promise<string | null> {
  if (!env?.ASSETS) return null;

  try {
    const shell = await env.ASSETS.fetch(new URL("_shell.html", "https://placeholder").toString());
    if (!shell.ok) return null;
    return await shell.text();
  } catch {
    return null;
  }
}


export default createServerEntry({
  fetch: (async (request: Request, env?: EnvWithAssets, ctx?: unknown) => {
    const requestId = getOrCreateRequestId(request);
    const requestWithId = attachCloudflareContext(withRequestIdHeader(request, requestId), env, ctx);

    const configError = validateProductionConfig(env);
    if (configError) return withRequestId(configError, requestId);

    const url = new URL(requestWithId.url);

    const isDevRequest = isDevelopment(env, url);

    // CNAME support: accept any hostname (ossmeet IS the meet product, no subdomain routing)

    // Server-to-server callbacks have no browser Origin/Referer header.
    // They are authenticated by secrets/signatures at route level, so CSRF
    // origin validation is not applicable and must be skipped for these paths.
    const isLiveKitWebhook = url.pathname === "/api/livekit/webhook";
    const isWhiteboardSnapshotCallback = url.pathname === "/api/whiteboard/snapshot";
    const skipCsrfOriginValidation = isLiveKitWebhook || isWhiteboardSnapshotCallback;

    if ((url.pathname.startsWith("/_serverFn/") || url.pathname.startsWith("/api/")) && !skipCsrfOriginValidation) {
      if (!validateCsrfOrigin(requestWithId, { appUrl: env?.APP_URL, environment: env?.ENVIRONMENT })) {
        return withRequestId(new Response("Forbidden: CSRF origin validation failed", { status: 403 }), requestId);
      }
    }

    // 1. Server functions and API routes — always invoke Worker
    if (url.pathname.startsWith("/_serverFn/") || url.pathname.startsWith("/api/")) {
      const response = await handler(requestWithId, {
        context: { cloudflare: { env: env as Env, ctx } } as any,
      });
      response.headers.set("Cache-Control", "private, no-store");
      return withRequestId(response, requestId);
    }

    const acceptsHtml = requestWithId.headers.get("Accept")?.includes("text/html");
    const shouldRenderPrivateHtml = isAuthenticatedRoute(url.pathname);

    if (acceptsHtml && isSpaShellRoute(url.pathname) && env?.ASSETS) {
      const shellHtml = await getSpaShellHtml(env);
      if (shellHtml) {
        let shellResponse = new Response(shellHtml, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            // The SPA shell embeds hashed asset URLs. Never cache it across deploys,
            // or clients can keep booting an HTML document that points at deleted chunks.
            "Cache-Control": "no-store",
          },
        });

        if (isMeetingCodeUrl(url.pathname)) {
          shellResponse = await injectMeetingPreloads(shellResponse, env);
        }

        return withRequestId(addSecurityHeaders(shellResponse, {
          enableHSTS: !isDevRequest && env?.APP_URL?.startsWith("https://"),
          isDevelopment: isDevRequest,
          isMeetRoute: isMeetRoute(url.pathname),
          contentSecurityPolicy: getMeetRouteCsp(url.pathname, env, isDevRequest),
          appUrl: env?.APP_URL,
          livekitUrl: env?.LIVEKIT_URL,
          whiteboardUrl: env?.WHITEBOARD_URL,
        }), requestId);
      }
    }

    if (acceptsHtml && shouldRenderPrivateHtml) {
      let response = await handler(requestWithId, {
        context: { cloudflare: { env: env as Env, ctx } } as any,
      });

      const contentType = response.headers.get("Content-Type") || "";
      if (contentType.includes("text/html")) {
        // For meeting code URLs, inject preload hints for the meeting lazy chunk
        // so the browser starts downloading it immediately instead of waiting for
        // React hydration + router match + dynamic import.
        if (isMeetingCodeUrl(url.pathname)) {
          response = await injectMeetingPreloads(response, env);
        }

        response.headers.set("Cache-Control", "private, no-store");
        return withRequestId(addSecurityHeaders(response, {
          enableHSTS: !isDevRequest && env?.APP_URL?.startsWith("https://"),
          isDevelopment: isDevRequest,
          isMeetRoute: isMeetRoute(url.pathname),
          contentSecurityPolicy: getMeetRouteCsp(url.pathname, env, isDevRequest),
          appUrl: env?.APP_URL,
          livekitUrl: env?.LIVEKIT_URL,
          whiteboardUrl: env?.WHITEBOARD_URL,
        }), requestId);
      }

      return withRequestId(response, requestId);
    }

    const securityOpts = {
      enableHSTS: !isDevRequest && env?.APP_URL?.startsWith("https://"),
      isDevelopment: isDevRequest,
      isMeetRoute: isMeetRoute(url.pathname),
      contentSecurityPolicy: getMeetRouteCsp(url.pathname, env, isDevRequest),
      appUrl: env?.APP_URL,
      livekitUrl: env?.LIVEKIT_URL,
      whiteboardUrl: env?.WHITEBOARD_URL,
    };

    // 2. For public HTML requests, check the Cache API first, then ASSETS, then SSR.
    // Only cache GET requests — non-GET HTML-accepting requests (extremely rare) must not
    // pollute the GET cache or be served stale cached responses.
    if (acceptsHtml && !isDevRequest && request.method === "GET") {
      // 2a. Cache API — serves repeated unauthenticated requests without touching
      //     the SSR pipeline or D1. Keyed on the canonical URL so CDN sharding
      //     doesn't prevent hits between Cloudflare PoPs.
      const cache = await getPublicCache();
      const cacheKey = new Request(url.toString(), { method: "GET" });
      if (cache) {
        const cached = await cache.match(cacheKey);
        if (cached) {
          const hit = new Response(cached.body, cached);
          hit.headers.set("X-Cache", "HIT");
          return withRequestId(addSecurityHeaders(hit, securityOpts), requestId);
        }
      }

      // 2b. ASSETS binding — serves prerendered static HTML when it exists.
      if (env?.ASSETS) {
        try {
          const assetResponse = await env.ASSETS.fetch(requestWithId);
          if (assetResponse.ok) {
            const served = new Response(assetResponse.body, assetResponse);
            served.headers.set(
              "Cache-Control",
              `public, max-age=${PUBLIC_HTML_CACHE_TTL}, s-maxage=${PUBLIC_HTML_CACHE_TTL}`,
            );
            const final = withRequestId(addSecurityHeaders(served, securityOpts), requestId);
            // Populate Cache API for next request
            if (cache) {
              (ctx as any)?.waitUntil?.(cache.put(cacheKey, final.clone()));
            }
            return final;
          }
        } catch (e) {
          logWarn("[assets] fetch failed, falling through to SSR:", { url: requestWithId.url }, e);
        }
      }
    }

    // 3. Fallback: Full SSR handler
    try {
      const response = await handler(requestWithId, {
        context: { cloudflare: { env: env as Env, ctx } } as any,
      });

      const contentType = response.headers.get("Content-Type") || "";
      if (contentType.includes("text/html")) {
        if (!response.headers.has("Cache-Control")) {
          response.headers.set(
            "Cache-Control",
            `public, max-age=${PUBLIC_HTML_CACHE_TTL}, s-maxage=${PUBLIC_HTML_CACHE_TTL}`,
          );
        }
        const final = withRequestId(addSecurityHeaders(response, securityOpts), requestId);
        // Populate Cache API so the next request for this public page is instant.
        // Only cache GET responses — a POST returning HTML must not poison the GET cache.
        if (acceptsHtml && !isDevRequest && request.method === "GET") {
          const cache = await getPublicCache();
          if (cache) {
            const cacheKey = new Request(url.toString(), { method: "GET" });
            (ctx as any)?.waitUntil?.(cache.put(cacheKey, final.clone()));
          }
        }
        return final;
      }

      return withRequestId(response, requestId);
    } catch (error) {
      if (isDevRequest) {
        logError("[server] SSR error in development:", { url: requestWithId.url }, error);
        return withRequestId(new Response("<!DOCTYPE html><html><body>SSR Error</body></html>", {
          status: 500,
          headers: { "Content-Type": "text/html" },
        }), requestId);
      }
      throw error;
    }
  }) as unknown as (request: Request) => Promise<Response>,
});
