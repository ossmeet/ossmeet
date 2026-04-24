export interface SecurityHeadersConfig {
  contentSecurityPolicy?: string;
  enableHSTS?: boolean;
  isDevelopment?: boolean;
  isMeetRoute?: boolean;
  appUrl?: string;
  livekitUrl?: string;
  whiteboardUrl?: string;
}

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function buildProductionCsp(config?: { appUrl?: string; livekitUrl?: string; whiteboardUrl?: string }): string {
  const appDomain = config?.appUrl ? getDomainFromUrl(config.appUrl) : "ossmeet.com";
  const whiteboardDomain = config?.whiteboardUrl ? getDomainFromUrl(config.whiteboardUrl) : `whiteboard.${appDomain}`;

  return [
    "default-src 'self'",
    // 'unsafe-inline' required: TanStack Start <Scripts /> injects inline hydration state
    // (dehydrated router + query client) as inline <script> tags with no nonce support.
    // Chrome DevTools flags this as a CSP policy weakness; it is unavoidable until
    // TanStack Start exposes nonce injection. TODO: drop once nonces are available.
    // cdn.paddle.com: Paddle.js billing overlay loaded dynamically on checkout.
    "script-src 'self' 'unsafe-inline' https://cdn.paddle.com",
    // Block inline event handler attributes (onclick="", onerror="", etc.)
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    // Explicit allowance for inline style attributes (style="…") used by animated
    // elements on the landing page. Inherits from style-src but stated explicitly.
    "style-src-attr 'unsafe-inline'",
    // Self-hosted fonts only — no external font CDNs
    "font-src 'self'",
    `img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://*.googleusercontent.com https://upload.wikimedia.org`,
    // blob: for media recorded/captured in browser
    "media-src 'self' blob:",
    // LiveKit/whiteboard WebSockets only needed on meet routes (see buildMeetRouteCsp).
    // api.paddle.com: Paddle.js makes XHR calls to Paddle's API during checkout.
    `connect-src 'self' https://*.r2.cloudflarestorage.com https://${whiteboardDomain} https://api.paddle.com`,
    // buy.paddle.com: Paddle checkout renders inside a sandboxed iframe.
    "frame-src https://buy.paddle.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: wss: ws: http://localhost:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function getCSP(config?: SecurityHeadersConfig): string {
  return config?.isDevelopment ? DEVELOPMENT_CSP : buildProductionCsp(config);
}

export function addSecurityHeaders(
  response: Response,
  config: SecurityHeadersConfig = {}
): Response {
  const headers = new Headers(response.headers);

  headers.set(
    "Content-Security-Policy",
    config.contentSecurityPolicy || getCSP(config)
  );
  // Use SAMEORIGIN to align with CSP frame-ancestors 'self' on meet routes
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Restrict camera/mic/display-capture to meet routes only.
  // Granting these to every page widens attack surface unnecessarily.
  const isMeet = config.isMeetRoute ?? false;
  headers.set(
    "Permissions-Policy",
    isMeet
      ? "camera=*, microphone=*, display-capture=*, geolocation=(), payment=()"
      : "camera=(), microphone=(), display-capture=(), geolocation=(), payment=()"
  );

  // Isolate this browsing context from cross-origin windows.
  // Prevents cross-origin attacks; safe because OAuth uses redirects (not popups).
  headers.set("Cross-Origin-Opener-Policy", "same-origin");

  // Prevent this resource from being embedded by cross-origin pages.
  headers.set("Cross-Origin-Resource-Policy", "same-site");

  // X-XSS-Protection is deprecated; CSP provides protection instead

  if (config.enableHSTS) {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function buildMeetRouteCsp(config?: { appUrl?: string; livekitUrl?: string; whiteboardUrl?: string }): string {
  const appDomain = config?.appUrl ? getDomainFromUrl(config.appUrl) : "ossmeet.com";
  const livekitDomain = config?.livekitUrl ? getDomainFromUrl(config.livekitUrl) : `livekit.${appDomain}`;
  const livekitTurnDomain = `livekit-turn.${appDomain}`;
  const whiteboardDomain = config?.whiteboardUrl ? getDomainFromUrl(config.whiteboardUrl) : `whiteboard.${appDomain}`;

  return [
    "default-src 'self'",
    // WebRTC signaling (LiveKit), whiteboard sync, R2 for assets/recordings.
    `connect-src 'self' https://*.r2.cloudflarestorage.com https://${livekitDomain} wss://${livekitDomain} https://${livekitTurnDomain} wss://${livekitTurnDomain} https://${whiteboardDomain} wss://${whiteboardDomain}`,
    "img-src 'self' blob: data: https://*.r2.cloudflarestorage.com https://*.googleusercontent.com https://upload.wikimedia.org",
    // 'unsafe-inline' required for TanStack Start hydration (see non-meet CSP comment).
    // 'unsafe-eval' required: MediaPipe tasks-vision runtime uses eval() for WASM initialization.
    // 'wasm-unsafe-eval' required: audio processing WASM modules.
    // blob: required: AudioWorklet loaded as a blob: script URL by the SDK.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
    "script-src-attr 'none'",
    // 'unsafe-inline' required for whiteboard engine runtime styles
    "style-src 'self' 'unsafe-inline'",
    // Self-hosted fonts + data: for base64 font rendering
    "font-src 'self' data:",
    // blob: for PDF.js Web Worker and whiteboard canvas worker
    "worker-src 'self' blob:",
    // blob: for WebRTC recorded streams; 'self' for media served by the Worker
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}
