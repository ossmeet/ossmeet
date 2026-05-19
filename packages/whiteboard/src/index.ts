import { RoomManager, type WsData } from "./room-manager";
import {
  TLSyncErrorCloseEventCode,
  TLSyncErrorCloseEventReason,
} from "@tldraw/sync-core";
import {
  validateBroadcastPayload,
  getBroadcastMessageType,
  isTrustedProxyIp,
} from "./security";
import { WHITEBOARD_EVENTS } from "./protocol";
import {
  parsePdfRenderPath,
  handlePdfRender,
  handlePdfRenderPage,
  handlePdfRenderCommit,
  handlePdfRenderCleanup,
} from "./pdf-render";
import { timingSafeEqual } from "./lib/crypto-utils";
import { verifyWhiteboardJWT, type WhiteboardJWTClaims } from "./lib/whiteboard-jwt";
import {
  MAX_HTTP_BODY_BYTES,
  addSecurityHeaders,
  createCorsHelpers,
  getContentLength,
  jsonBodyErrorResponse,
  readBoundedJson,
} from "./server/http";
import { loadWhiteboardServerConfig } from "./server/config";
import { handleUnfurl } from "./server/unfurl";

const {
  port: PORT,
  dataDir: DATA_DIR,
  appUrl: APP_URL,
  whiteboardInternalSecret: WHITEBOARD_INTERNAL_SECRET,
  whiteboardJwtSecret: WHITEBOARD_JWT_SECRET,
  pdfImportR2Config: PDF_IMPORT_R2_CONFIG,
  snapshotCallbackUrl,
  whiteboardAccessValidationUrl,
  allowedOrigins: ALLOWED_ORIGINS,
  allowInsecureAllOrigins: ALLOW_INSECURE_ALL_ORIGINS,
  trustedProxyIps: TRUST_PROXY_IPS,
} = loadWhiteboardServerConfig();

const MAX_USER_NAME_BYTES = 256;

const roomManager = new RoomManager(DATA_DIR, {
  callbackUrl: snapshotCallbackUrl,
  callbackSecret: WHITEBOARD_INTERNAL_SECRET,
});

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

// Per-user unfurl rate limiter: 10 requests per 10 s per user/IP.
const unfurlCounts = new Map<string, { count: number; resetAt: number }>();
const UNFURL_LIMIT = 10;
const UNFURL_WINDOW_MS = 10_000;
function checkUnfurlRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = unfurlCounts.get(key);
  if (!entry || now >= entry.resetAt) {
    unfurlCounts.set(key, { count: 1, resetAt: now + UNFURL_WINDOW_MS });
    return true;
  }
  if (entry.count >= UNFURL_LIMIT) return false;
  entry.count++;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of unfurlCounts) {
    if (now >= v.resetAt) unfurlCounts.delete(k);
  }
}, UNFURL_WINDOW_MS * 5);

// Per-IP connection rate limiter.
const ipConnectionCounts = new Map<string, { count: number; resetAt: number }>();
const IP_RATE_LIMIT = parsePositiveInt(process.env.IP_RATE_LIMIT, 60);
const IP_RATE_WINDOW_MS = parsePositiveInt(process.env.IP_RATE_WINDOW_MS, 60_000);
// Hard cap on distinct tracked IPs to prevent memory inflation from spoofed IPs
const IP_COUNT_CAP = parsePositiveInt(process.env.IP_COUNT_CAP, 50_000);

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipConnectionCounts.get(ip);
  if (!entry || now >= entry.resetAt) {
    // Evict stale or oldest entries when cap reached to prevent unbounded growth
    if (!entry && ipConnectionCounts.size >= IP_COUNT_CAP) {
      // Remove expired entries first
      for (const [k, v] of ipConnectionCounts) {
        if (now >= v.resetAt) ipConnectionCounts.delete(k);
      }
      // If still at cap, evict the entry closest to expiry (smallest remaining window)
      if (ipConnectionCounts.size >= IP_COUNT_CAP) {
        let oldestKey: string | null = null;
        let oldestResetAt = Infinity;
        for (const [k, v] of ipConnectionCounts) {
          if (v.resetAt < oldestResetAt) {
            oldestResetAt = v.resetAt;
            oldestKey = k;
          }
        }
        if (oldestKey) ipConnectionCounts.delete(oldestKey);
      }
      if (ipConnectionCounts.size >= IP_COUNT_CAP) return false;
    }
    ipConnectionCounts.set(ip, { count: 1, resetAt: now + IP_RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= IP_RATE_LIMIT;
}

// Periodic cleanup of stale IP entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipConnectionCounts) {
    if (now >= entry.resetAt) ipConnectionCounts.delete(ip);
  }
}, IP_RATE_WINDOW_MS);

// ─── Validation helpers ───────────────────────────────────────────────

const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
// Covers plain user IDs and compound "${userId}_${admissionId}" formats
const USER_ID_REGEX = /^[a-zA-Z0-9_-]{1,192}$/;

function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_REGEX.test(sessionId);
}

// ─── JWT helpers ──────────────────────────────────────────────────────

// Use the shared JWT verification from whiteboard-jwt.ts which validates
// all claims including iat, iss, and aud. This avoids duplicating crypto code.
type JWTClaims = WhiteboardJWTClaims;

// valid role values
const VALID_ROLES = new Set(["host", "participant", "guest"]);

function verifyJWT(token: string, secret: string): Promise<JWTClaims> {
  return verifyWhiteboardJWT(token, secret);
}

const { corsHeaders, withCors } = createCorsHelpers({
  allowedOrigins: ALLOWED_ORIGINS,
  allowInsecureAllOrigins: ALLOW_INSECURE_ALL_ORIGINS,
});

function getWebSocketAuthToken(req: Request): string | null {
  const header = req.headers.get("Sec-WebSocket-Protocol");
  return header
    ? (
    header
      .split(",")
      .map((protocol) => protocol.trim())
      .find((protocol) => protocol && protocol !== "ossmeet-wb") ?? null
    )
    : null;
}

async function validateActiveParticipantAccess(claims: JWTClaims): Promise<"allowed" | "denied" | "unavailable"> {
  if (claims.service === "recorder") {
    return "allowed";
  }
  if (!claims.connectionId) {
    return "denied";
  }

  // Retry once on transient failures (DNS blips, network timeouts) to avoid
  // blocking WebSocket upgrades due to momentary connectivity issues between
  // the VPS and the web app (Cloudflare).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(whiteboardAccessValidationUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Whiteboard-Secret": WHITEBOARD_INTERNAL_SECRET,
        },
        body: JSON.stringify({
          connectionId: claims.connectionId,
          sid: claims.sid,
          sub: claims.sub,
          role: claims.role,
        }),
        signal: AbortSignal.timeout(attempt === 0 ? 4_000 : 3_000),
      });

      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        return response.status >= 500 ? "unavailable" : "denied";
      }

      const body = await response.json().catch(() => null);
      return body && typeof body === "object" && (body as { active?: boolean }).active === true
        ? "allowed"
        : "denied";
    } catch (err) {
      if (attempt === 0) {
        console.warn("[ws] access validation attempt failed, retrying", err instanceof Error ? err.message : err);
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      return "unavailable";
    }
  }
  return "unavailable";
}

type WsFatalCloseReason =
  | typeof TLSyncErrorCloseEventReason.NOT_AUTHENTICATED
  | typeof TLSyncErrorCloseEventReason.FORBIDDEN
  | typeof TLSyncErrorCloseEventReason.RATE_LIMITED;

function upgradeRejectedWebSocket(
  req: Request,
  fatalReason: WsFatalCloseReason,
  data: Partial<WsData> = {},
): Response | undefined {
  const upgraded = server.upgrade(req, {
    data: {
      tldrawSessionId: `rejected:${crypto.randomUUID().slice(0, 8)}`,
      userId: "rejected",
      userName: "rejected",
      role: "rejected",
      roomId: "",
      connectionId: "",
      authCloseReason: fatalReason,
      ...data,
    } satisfies WsData,
    headers: {
      "Sec-WebSocket-Protocol": "ossmeet-wb",
    },
  });

  if (!upgraded) {
    return addSecurityHeaders(new Response("WebSocket upgrade failed", { status: 500 }));
  }

  return undefined as unknown as Response;
}

// ─── Bun server ───────────────────────────────────────────────────────

const server = Bun.serve<WsData>({
  port: PORT,

  async fetch(req, bunServer) {
    const url = new URL(req.url, `http://${req.headers.get("host") ?? "localhost"}`);

    // Handle CORS preflight for all non-WebSocket endpoints
    if (req.method === "OPTIONS") {
      return addSecurityHeaders(new Response(null, { status: 204, headers: corsHeaders(req) }));
    }

    // WebSocket upgrade: verify JWT, then upgrade
    if (url.pathname === "/connect") {
      // Validate Origin header against allowlist
      const origin = req.headers.get("Origin");
      if (!origin) {
        console.warn(`[ws] rejected missing origin session=${url.searchParams.get("sessionId") ?? "unknown"}`);
        return upgradeRejectedWebSocket(req, TLSyncErrorCloseEventReason.FORBIDDEN);
      }
      if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
        console.warn(`[ws] rejected forbidden origin origin=${origin} session=${url.searchParams.get("sessionId") ?? "unknown"}`);
        return upgradeRejectedWebSocket(req, TLSyncErrorCloseEventReason.FORBIDDEN);
      }
      if (ALLOWED_ORIGINS.length === 0 && !ALLOW_INSECURE_ALL_ORIGINS) {
        console.warn(`[ws] rejected no allowed origins configured origin=${origin} session=${url.searchParams.get("sessionId") ?? "unknown"}`);
        return upgradeRejectedWebSocket(req, TLSyncErrorCloseEventReason.FORBIDDEN);
      }

      // Use actual connecting IP; only trust XFF/X-Real-IP from configured trusted proxies
      const connectingAddress = bunServer.requestIP(req);
      const connectingIp = connectingAddress?.address ?? "unknown";
      const clientIp =
        TRUST_PROXY_IPS.length > 0 && isTrustedProxyIp(connectingIp, TRUST_PROXY_IPS)
          ? (req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
              req.headers.get("X-Real-IP") ||
              connectingIp)
          : connectingIp;

      if (!checkIpRateLimit(clientIp)) {
        console.warn(
          `[ws] rate-limited ip=${clientIp} origin=${origin ?? "unknown"} session=${url.searchParams.get("sessionId") ?? "unknown"}`
        );
        return upgradeRejectedWebSocket(req, TLSyncErrorCloseEventReason.RATE_LIMITED);
      }

      // Only accept token from Sec-WebSocket-Protocol. The client-side proxy in
      // install-whiteboard-ws-auth.ts moves the JWT there before opening the socket.
      const token = getWebSocketAuthToken(req);
      if (!token) {
        console.warn(
          `[ws] rejected missing token origin=${origin} session=${url.searchParams.get("sessionId") ?? "unknown"} hasQueryToken=${url.searchParams.has("token")}`,
        );
        return upgradeRejectedWebSocket(req, TLSyncErrorCloseEventReason.NOT_AUTHENTICATED);
      }

      let claims: JWTClaims;
      try {
        claims = await verifyJWT(token, WHITEBOARD_JWT_SECRET);
      } catch {
        console.warn(`[ws] rejected invalid token origin=${origin} session=${url.searchParams.get("sessionId") ?? "unknown"}`);
        return upgradeRejectedWebSocket(req, TLSyncErrorCloseEventReason.NOT_AUTHENTICATED);
      }
      const accessStatus = await validateActiveParticipantAccess(claims);
      if (accessStatus === "denied") {
        console.warn(`[ws] rejected inactive participant sub=${claims.sub} sid=${claims.sid}`);
        return upgradeRejectedWebSocket(req, TLSyncErrorCloseEventReason.FORBIDDEN, {
          userId: claims.sub,
          userName: claims.name,
          role: claims.role,
          roomId: claims.sid,
          connectionId: claims.connectionId,
        });
      }
      if (accessStatus === "unavailable") {
        // Allow the connection to proceed — the JWT is already verified which
        // proves the user was recently authenticated for this meeting. Blocking
        // the WebSocket upgrade entirely (HTTP 503) makes the whiteboard unusable
        // during transient connectivity issues between the VPS and Cloudflare.
        console.warn(`[ws] access validation unavailable, allowing JWT-authenticated user sub=${claims.sub} sid=${claims.sid}`);
      }

      // Validate sid before using it as a room ID (prevents path traversal)
      if (!SESSION_ID_REGEX.test(claims.sid)) {
        return addSecurityHeaders(new Response("Invalid session ID in token", { status: 400 }));
      }

      await roomManager.prepareRoom(claims.sid);

      const tldrawSessionId = `${claims.sub}:${crypto.randomUUID().slice(0, 8)}`;
      // Respond with a non-sensitive Sec-WebSocket-Protocol value so the
      // JWT is not echoed back in the response header (proxies/CDNs often log it).
      const upgraded = server.upgrade(req, {
        data: {
          tldrawSessionId,
          userId: claims.sub,
          userName: claims.name,
          role: claims.role,
          roomId: claims.sid,
          connectionId: claims.connectionId,
        } satisfies WsData,
        headers: {
          "Sec-WebSocket-Protocol": "ossmeet-wb",
        },
      });

      if (!upgraded) {
        roomManager.closeRoomIfEmpty(claims.sid);
        return addSecurityHeaders(new Response("WebSocket upgrade failed", { status: 500 }));
      }
      return undefined as unknown as Response;
    }

    // Health check — only expose basic status, not room count
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/health") {
      const connectingAddress = bunServer.requestIP(req);
      const connectingIp = connectingAddress?.address ?? "unknown";
      if (!checkIpRateLimit(connectingIp)) {
        return addSecurityHeaders(new Response("Too many requests", { status: 429 }));
      }
      if (req.method === "HEAD") {
        return addSecurityHeaders(
          new Response(null, {
            status: 200,
            headers: {
              "Content-Type": "application/json;charset=utf-8",
            },
          }),
        );
      }
      return addSecurityHeaders(Response.json({ ok: true }));
    }

    // URL unfurling for bookmark shapes — accepts JWT or internal secret
    if (req.method === "POST" && url.pathname === "/unfurl") {
      // Reject non-JSON content types to prevent CSRF via content-type sniffing
      const contentType = req.headers.get("Content-Type");
      if (!contentType || !contentType.includes("application/json")) {
        return withCors(Response.json({ error: "Content-Type must be application/json" }, { status: 415 }), req);
      }

      // Try internal secret first
      const authSecret = req.headers.get("X-Whiteboard-Secret");
      if (authSecret && (await timingSafeEqual(authSecret, WHITEBOARD_INTERNAL_SECRET))) {
        return withCors(await handleUnfurl(req), req);
      }
      // Fall back to JWT in Authorization header
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        try {
          const claims = await verifyJWT(authHeader.slice(7), WHITEBOARD_JWT_SECRET);
          const accessStatus = await validateActiveParticipantAccess(claims);
          if (accessStatus === "denied") {
            return withCors(new Response("Token no longer valid for this meeting", { status: 401 }), req);
          }
          if (accessStatus === "unavailable") {
            return withCors(new Response("Whiteboard auth unavailable", { status: 503 }), req);
          }
          if (!checkUnfurlRateLimit(claims.sub)) {
            return withCors(new Response("Too many requests", { status: 429 }), req);
          }
          return withCors(await handleUnfurl(req), req);
        } catch {
          return withCors(new Response("Invalid token", { status: 401 }), req);
        }
      }
      return withCors(new Response("Unauthorized", { status: 401 }), req);
    }

    // Broadcast endpoint — JWT authenticated, sends custom message to all participants
    if (req.method === "POST" && url.pathname === "/broadcast") {
      // Validate Origin header to prevent cross-origin request forgery
      const broadcastOrigin = req.headers.get("Origin");
      if (broadcastOrigin) {
        if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(broadcastOrigin)) {
          return withCors(new Response("Forbidden origin", { status: 403 }), req);
        }
        if (ALLOWED_ORIGINS.length === 0 && !ALLOW_INSECURE_ALL_ORIGINS) {
          return withCors(new Response("Forbidden origin", { status: 403 }), req);
        }
      }

      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return withCors(new Response("Unauthorized", { status: 401 }), req);
      }
      let claims: JWTClaims;
      try {
        claims = await verifyJWT(authHeader.slice(7), WHITEBOARD_JWT_SECRET);
      } catch {
        return withCors(new Response("Invalid token", { status: 401 }), req);
      }
      const accessStatus = await validateActiveParticipantAccess(claims);
      if (accessStatus === "denied") {
        return withCors(new Response("Token no longer valid for this meeting", { status: 401 }), req);
      }
      if (accessStatus === "unavailable") {
        return withCors(new Response("Whiteboard auth unavailable", { status: 503 }), req);
      }

      // Pre-check Content-Length to reject oversized payloads before parsing
      const contentLength = getContentLength(req);
      if (contentLength !== null && contentLength > MAX_HTTP_BODY_BYTES) {
          return withCors(Response.json({ error: "Payload too large" }, { status: 413 }), req);
      }

      let body: { data?: unknown };
      try {
        body = await readBoundedJson<{ data?: unknown }>(req);
      } catch (error) {
        return withCors(jsonBodyErrorResponse(error), req);
      }
      if (!body.data) {
        return withCors(Response.json({ error: "Missing data" }, { status: 400 }), req);
      }
      const room = roomManager.getRoomIfExists(claims.sid);
      if (!room) return withCors(Response.json({ error: "Room not found" }, { status: 404 }), req);
      if (!room.canAcceptBroadcast(claims.sub, claims.role, body.data)) {
        return withCors(Response.json({ error: "Forbidden" }, { status: 403 }), req);
      }
      // validate per-type broadcast payload shape to prevent injecting malformed data
      const msgType = getBroadcastMessageType(body.data);
      if (msgType && !validateBroadcastPayload(msgType, body.data)) {
        return withCors(Response.json({ error: "Invalid broadcast payload" }, { status: 400 }), req);
      }
      let broadcastData = body.data;
      if (msgType === WHITEBOARD_EVENTS.ASSISTANT_CHAT_USER && body.data && typeof body.data === "object") {
        const data = body.data as { message?: { id: string; role: string; content: string; userName?: string; whiteboardAttached?: boolean } };
        if (data.message) {
          broadcastData = {
            ...data,
            message: {
              ...data.message,
              userName: claims.name,
            },
          };
        }
      }

      if (msgType === WHITEBOARD_EVENTS.ASSISTANT_PANEL_OPEN) {
        room.setAiPanelState(true);
      } else if (msgType === WHITEBOARD_EVENTS.ASSISTANT_PANEL_CLOSE) {
        room.setAiPanelState(false);
      } else if (msgType === WHITEBOARD_EVENTS.ASSISTANT_CHAT_USER || msgType === WHITEBOARD_EVENTS.ASSISTANT_CHAT_ASSISTANT) {
        if (msgType === WHITEBOARD_EVENTS.ASSISTANT_CHAT_USER) {
          room.setAiPanelState(true);
        }
        // Store chat messages for late joiners
        const chatData = broadcastData as { message?: { id: string; role: string; content: string; userName?: string; whiteboardAttached?: boolean } };
        if (chatData.message) {
          room.storeAiChatMessage(chatData.message);
        }
      } else if (msgType === WHITEBOARD_EVENTS.ASSISTANT_CHAT_CLEAR) {
        room.clearAiChatMessages();
      }
      return withCors(room.broadcastToAll(broadcastData, claims.connectionId), req);
    }

    // AI chat history endpoint — JWT authenticated
    if (req.method === "GET" && url.pathname === "/ai-chat-history") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return withCors(new Response("Unauthorized", { status: 401 }), req);
      }
      let claims: JWTClaims;
      try {
        claims = await verifyJWT(authHeader.slice(7), WHITEBOARD_JWT_SECRET);
      } catch {
        return withCors(new Response("Invalid token", { status: 401 }), req);
      }
      const accessStatus = await validateActiveParticipantAccess(claims);
      if (accessStatus === "denied") {
        return withCors(new Response("Token no longer valid for this meeting", { status: 401 }), req);
      }
      if (accessStatus === "unavailable") {
        return withCors(new Response("Whiteboard auth unavailable", { status: 503 }), req);
      }
      const room = roomManager.getRoomIfExists(claims.sid);
      if (!room) return withCors(Response.json({ messages: [] }), req);
      return withCors(room.getAiChatHistory(), req);
    }

    // PDF rendering is browser-called and JWT authenticated, so it must run
    // before the internal-secret-only branch below or CORS/auth will fail.
    const pdfRoute = parsePdfRenderPath(url.pathname);
    if (pdfRoute) {
      if (req.method === "OPTIONS") {
        return addSecurityHeaders(new Response(null, { status: 204, headers: corsHeaders(req) }));
      }
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return withCors(new Response("Unauthorized", { status: 401 }), req);
      }
      let pdfClaims: JWTClaims;
      try {
        pdfClaims = await verifyJWT(authHeader.slice(7), WHITEBOARD_JWT_SECRET);
      } catch {
        return withCors(new Response("Invalid token", { status: 401 }), req);
      }
      const accessStatus = await validateActiveParticipantAccess(pdfClaims);
      if (accessStatus === "denied") {
        return withCors(new Response("Token no longer valid for this meeting", { status: 401 }), req);
      }
      if (accessStatus === "unavailable") {
        return withCors(new Response("Whiteboard auth unavailable", { status: 503 }), req);
      }

      let resp: Response;
      if (pdfRoute.type === "render") {
        resp = await handlePdfRender(req, pdfClaims.sub);
      } else if (pdfRoute.type === "page") {
        resp = await handlePdfRenderPage(req, pdfRoute.id, pdfRoute.pageIndex, pdfClaims.sub);
      } else if (pdfRoute.type === "commit") {
        if (
          !PDF_IMPORT_R2_CONFIG.accessKeyId ||
          !PDF_IMPORT_R2_CONFIG.secretAccessKey ||
          !PDF_IMPORT_R2_CONFIG.accountId ||
          !PDF_IMPORT_R2_CONFIG.bucketName
        ) {
          resp = new Response("PDF import storage is not configured", { status: 503 });
        } else {
          // Intentional: pdfClaims.sub is both the participant identity (for
          // access control) and the user ID (for job ownership). If JWT claim
          // semantics diverge, pass undefined for the 9th param (userId) and
          // update handlePdfRenderCommit to use participantIdentity instead.
          resp = await handlePdfRenderCommit(
            req,
            pdfRoute.id,
            pdfClaims.sid,
            pdfClaims.connectionId,
            pdfClaims.sub,
            APP_URL,
            WHITEBOARD_INTERNAL_SECRET,
            PDF_IMPORT_R2_CONFIG,
            pdfClaims.sub,
          );
        }
      } else {
        resp = await handlePdfRenderCleanup(req, pdfRoute.id, pdfClaims.sub);
      }
      return withCors(resp, req);
    }

    // All other endpoints require internal secret
    const authSecret = req.headers.get("X-Whiteboard-Secret");
    if (!authSecret || !(await timingSafeEqual(authSecret, WHITEBOARD_INTERNAL_SECRET))) {
      return addSecurityHeaders(new Response("Unauthorized", { status: 401 }));
    }

    if (req.method === "POST") {
      if (url.pathname === "/access/check" || url.pathname === "/writer-check") {
        return addSecurityHeaders(await handleCanvasEditAccessCheck(req));
      }
      if (url.pathname.startsWith("/access/")) {
        const action = url.pathname.slice("/access/".length);
        return addSecurityHeaders(await handleCanvasAccessAction(req, action));
      }
      if (url.pathname.startsWith("/writer/")) {
        const action = url.pathname.slice("/writer/".length);
        return addSecurityHeaders(await handleCanvasAccessAction(req, action));
      }
      if (url.pathname === "/session-end") return addSecurityHeaders(await handleSessionEnd(req));
      if (url.pathname === "/manager/promote" || url.pathname === "/host/promote") {
        return addSecurityHeaders(await handleActingManagerPromote(req));
      }
      if (url.pathname === "/page/sync") return addSecurityHeaders(await handlePageSync(req));
      if (url.pathname === "/navigation-controller/set" || url.pathname === "/presenter/set") {
        return addSecurityHeaders(await handleNavigationControllerAction(req, "set"));
      }
      if (url.pathname === "/navigation-controller/release" || url.pathname === "/presenter/release") {
        return addSecurityHeaders(await handleNavigationControllerAction(req, "release"));
      }
    }

    if (req.method === "GET" && url.pathname.startsWith("/state/")) {
      const sessionId = url.pathname.slice("/state/".length);
      if (!sessionId || !isValidSessionId(sessionId)) {
        return addSecurityHeaders(new Response("Invalid sessionId", { status: 400 }));
      }
      const requesterId = url.searchParams.get("requesterId") ?? undefined;
      if (requesterId !== undefined && !USER_ID_REGEX.test(requesterId)) {
        return addSecurityHeaders(new Response("Invalid requesterId", { status: 400 }));
      }
      // Use getRoomIfExists for management endpoints to avoid creating orphans
      const room = roomManager.getRoomIfExists(sessionId);
      if (!room) {
        return addSecurityHeaders(Response.json({
          connections: 0,
          canvasEditorUserIds: [],
          editorUserIds: [],
          pendingEditorRequests: [],
          writerUserIds: [],
          pendingRequests: [],
        }));
      }
      return addSecurityHeaders(room.getState(requesterId));
    }

    return addSecurityHeaders(new Response("Not found", { status: 404 }));
  },

  websocket: {
    open(ws) {
      if (ws.data?.authCloseReason) {
        console.warn("[ws] open: closing rejected socket", ws.data.authCloseReason);
        ws.close(TLSyncErrorCloseEventCode, ws.data.authCloseReason);
        return;
      }
      if (!ws.data?.roomId) {
        console.warn("[ws] open: missing roomId, closing", ws.data);
        ws.close(1008, "Missing roomId");
        return;
      }
      console.info("[ws] open:", ws.data.userId, "room:", ws.data.roomId);
      try {
        roomManager.getOrCreateRoom(ws.data.roomId).handleConnect(ws, ws.data);
      } catch (e) {
        console.error("[ws] open: handleConnect threw", e);
        ws.close(1011, "Server error");
      }
    },
    message(ws, data) {
      if (!ws.data?.roomId) return;
      // Use getRoomIfExists to avoid silently recreating cleaned-up rooms
      const room = roomManager.getRoomIfExists(ws.data.roomId);
      if (!room) {
        ws.close(1011, "Room no longer exists");
        return;
      }
      try {
        const msg =
          typeof data === "string"
            ? data
            : data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        room.handleMessage(ws.data.tldrawSessionId, msg);
      } catch (e) {
        console.error("[ws] message: handler threw", e);
        ws.close(1011, "Server error");
      }
    },
    close(ws, code) {
      if (!ws.data?.roomId) return;
      console.info("[ws] close:", ws.data.tldrawSessionId, "code:", code);
      // Handle both normal close and error-triggered close to prevent
      // activeSockets/rateLimiter leaks from error-disconnected sockets
      const room = roomManager.getRoomIfExists(ws.data.roomId);
      if (room) {
        room.handleClose(ws.data.tldrawSessionId, code, ws);
      }
    },
    perMessageDeflate: false,
    sendPings: true,
    idleTimeout: 30,
    maxPayloadLength: 1 * 1024 * 1024, // 1 MB max message size (sufficient for CRDT messages)
  },
});

console.info(`[whiteboard-server] Listening on port ${server.port}`);

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[whiteboard-server] ${signal} received, shutting down`);

  void (async () => {
    try {
      await roomManager.closeAll();
    } catch (error) {
      console.error("[whiteboard-server] Failed to close rooms during shutdown:", error);
    }

    try {
      server.stop(true);
    } catch (error) {
      console.error("[whiteboard-server] Failed to stop server:", error);
    }
  })();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── HTTP route handlers ──────────────────────────────────────────────

async function handleCanvasAccessAction(
  req: Request,
  action: string
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson<Record<string, unknown>>(req);
  } catch (error) {
    return jsonBodyErrorResponse(error);
  }

  const { sessionId } = body;
  if (typeof sessionId !== "string" || !isValidSessionId(sessionId)) {
    return Response.json({ error: "Invalid sessionId" }, { status: 400 });
  }

  const isValidUserId = (value: unknown): value is string =>
    typeof value === "string" && USER_ID_REGEX.test(value);
  const isValidRole = (value: unknown): value is string =>
    typeof value === "string" && VALID_ROLES.has(value);
  const sanitizeUserName = (value: unknown): string => {
    if (typeof value !== "string") return "";
    const stripped = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
    const encoded = new TextEncoder().encode(stripped);
    if (encoded.byteLength <= MAX_USER_NAME_BYTES) return stripped;
    return new TextDecoder().decode(encoded.slice(0, MAX_USER_NAME_BYTES)).replace(/\uFFFD$/, "");
  };

  // Use getRoomIfExists to avoid creating orphan rooms for management endpoints
  const room = roomManager.getRoomIfExists(sessionId);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
  switch (action) {
    case "request": {
      if (!isValidUserId(body.userId))
        return Response.json({ error: "Missing userId" }, { status: 400 });
      const role = body.role === undefined ? "participant" : body.role;
      if (!isValidRole(role)) {
        return Response.json({ error: "Invalid role" }, { status: 400 });
      }
      return room.requestCanvasEditAccess(body.userId, sanitizeUserName(body.userName), role);
    }
    case "approve":
      if (!isValidUserId(body.targetUserId) || !isValidUserId(body.approverId))
        return Response.json(
          { error: "Missing targetUserId or approverId" },
          { status: 400 }
        );
      return room.grantCanvasEditAccess(body.targetUserId, body.approverId);
    case "deny":
      if (!isValidUserId(body.targetUserId) || !isValidUserId(body.approverId))
        return Response.json(
          { error: "Missing targetUserId or approverId" },
          { status: 400 }
        );
      return room.denyCanvasEditAccessRequest(body.targetUserId, body.approverId);
    case "release":
      if (!isValidUserId(body.userId))
        return Response.json({ error: "Missing userId" }, { status: 400 });
      if (!isValidUserId(body.requesterId))
        return Response.json({ error: "Missing requesterId" }, { status: 400 });
      return room.revokeCanvasEditAccess(body.userId, body.requesterId);
    default:
      return Response.json({ error: "Invalid action" }, { status: 400 });
  }
}

async function handleSessionEnd(req: Request): Promise<Response> {
  let body: { sessionId?: string };
  try {
    body = await readBoundedJson<{ sessionId?: string }>(req);
  } catch (error) {
    return jsonBodyErrorResponse(error);
  }
  if (!body.sessionId || !isValidSessionId(body.sessionId)) {
    return Response.json({ error: "Invalid sessionId" }, { status: 400 });
  }
  // Use getRoomIfExists to avoid creating orphan rooms on session-end
  const room = roomManager.getRoomIfExists(body.sessionId);
  if (!room) return Response.json({ status: "not_found" });
  return await room.endSession();
}

async function handleCanvasEditAccessCheck(req: Request): Promise<Response> {
  let body: { sessionId?: string; userId?: string; role?: string };
  try {
    body = await readBoundedJson<{ sessionId?: string; userId?: string; role?: string }>(req);
  } catch (error) {
    return jsonBodyErrorResponse(error);
  }
  if (
    !body.sessionId ||
    !isValidSessionId(body.sessionId) ||
    !body.userId ||
    !USER_ID_REGEX.test(body.userId) ||
    !body.role ||
    !VALID_ROLES.has(body.role)
  ) {
    return Response.json({ error: "Invalid or missing sessionId, userId, or role" }, { status: 400 });
  }

  const room = roomManager.getRoomIfExists(body.sessionId);
  if (!room) return Response.json({ canEditCanvas: false, canWrite: false });
  return room.checkCanvasEditAccess(body.userId, body.role);
}

async function handleActingManagerPromote(req: Request): Promise<Response> {
  let body: { sessionId?: string; userId?: string };
  try {
    body = await readBoundedJson<{ sessionId?: string; userId?: string }>(req);
  } catch (error) {
    return jsonBodyErrorResponse(error);
  }
  if (!body.sessionId || !isValidSessionId(body.sessionId) || !body.userId || !USER_ID_REGEX.test(body.userId)) {
    return Response.json({ error: "Invalid or missing sessionId or userId" }, { status: 400 });
  }
  const room = roomManager.getRoomIfExists(body.sessionId);
  if (!room) return Response.json({ status: "not_found" });
  return room.promoteActingManager(body.userId);
}

async function handleNavigationControllerAction(req: Request, action: "set" | "release"): Promise<Response> {
  let body: Record<string, string>;
  try {
    body = await readBoundedJson<Record<string, string>>(req);
  } catch (error) {
    return jsonBodyErrorResponse(error);
  }

  const { sessionId } = body;
  if (!sessionId || !isValidSessionId(sessionId)) {
    return Response.json({ error: "Invalid sessionId" }, { status: 400 });
  }

  const room = roomManager.getRoomIfExists(sessionId);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });

  if (action === "set") {
    if (!body.targetUserId || !USER_ID_REGEX.test(body.targetUserId) || !body.approverId || !USER_ID_REGEX.test(body.approverId))
      return Response.json({ error: "Missing or invalid targetUserId or approverId" }, { status: 400 });
    return room.setNavigationController(body.targetUserId, body.approverId);
  }

  // release
  if (!body.requesterId || !USER_ID_REGEX.test(body.requesterId))
    return Response.json({ error: "Missing or invalid requesterId" }, { status: 400 });
  return room.releaseNavigationController(body.requesterId);
}

async function handlePageSync(req: Request): Promise<Response> {
  let body: { sessionId?: string; userId?: string; pageNumber?: number; connectionId?: string };
  try {
    body = await readBoundedJson<{
      sessionId?: string;
      userId?: string;
      pageNumber?: number;
      connectionId?: string;
    }>(req);
  } catch (error) {
    return jsonBodyErrorResponse(error);
  }
  if (
    !body.sessionId ||
    !isValidSessionId(body.sessionId) ||
    !body.userId ||
    !USER_ID_REGEX.test(body.userId) ||
    typeof body.pageNumber !== "number" ||
    !Number.isFinite(body.pageNumber)
  ) {
    return Response.json(
      { error: "Invalid or missing sessionId, userId, or pageNumber" },
      { status: 400 }
    );
  }
  const room = roomManager.getRoomIfExists(body.sessionId);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
  return room.syncPage(body.userId, body.pageNumber, body.connectionId);
}
