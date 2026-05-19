import { createDb } from "@ossmeet/db";
import { verifyWhiteboardJWT } from "../../lib/whiteboard-jwt";
import { extractMeetingIdFromWhiteboardUploadKey } from "../../lib/whiteboard-asset-key";
import { getWhiteboardAssetTokenFromCookie } from "../lib/whiteboard-cookies.ts";
import { verifySessionFromRawRequest } from "@/server/auth/helpers";
import { canAccessMeetingTranscriptData } from "@/server/transcripts/access";
import { getActiveWhiteboardParticipantAccess } from "../server/meetings/whiteboard-access";

const SAFE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
]);

async function verifyWhiteboardAssetToken(
  request: Request,
  env: Env,
  db: ReturnType<typeof createDb>,
  meetingId: string,
): Promise<"allowed" | "missing" | "invalid" | "forbidden"> {
  const cookieHeader = request.headers.get("Cookie");
  const bearer = request.headers.get("Authorization");
  const queryToken = new URL(request.url).searchParams.get("wbToken");
  const wbToken = bearer?.startsWith("Bearer ")
    ? bearer.slice("Bearer ".length).trim()
    : getWhiteboardAssetTokenFromCookie(cookieHeader, meetingId) ?? queryToken;

  if (!wbToken || !env.WHITEBOARD_JWT_SECRET) {
    return "missing";
  }

  try {
    const claims = await verifyWhiteboardJWT(wbToken, env.WHITEBOARD_JWT_SECRET);
    if (claims.sid !== `meet-${meetingId}`) return "forbidden";
    if (queryToken) {
      return claims.service === "recorder" ? "allowed" : "forbidden";
    }
    if (claims.service === "recorder") return "allowed";
    const access = await getActiveWhiteboardParticipantAccess(db, meetingId, claims.connectionId);
    if (!access || access.participantIdentity !== claims.sub) {
      return "forbidden";
    }
    return "allowed";
  } catch {
    return "invalid";
  }
}

export async function handleWbAssets(request: Request, env: Env, key: string): Promise<Response> {
  if (!key || key.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const meetingId = extractMeetingIdFromWhiteboardUploadKey(key);
  if (!meetingId) {
    return new Response("Forbidden", { status: 403 });
  }

  const bucket = env.R2_BUCKET;
  if (!bucket) {
    return new Response("Storage unavailable", { status: 503 });
  }

  const session = await verifySessionFromRawRequest(request, env);
  const db = createDb(env.DB);

  // Always verify the whiteboard token first — it proves the user has an active
  // whiteboard session in this specific meeting. Authenticated sessions without
  // a valid token fall through to the broader meeting membership check below.
  const tokenStatus = await verifyWhiteboardAssetToken(request, env, db, meetingId);

  if (tokenStatus === "allowed") {
    // Valid whiteboard token — access granted regardless of auth session
  } else if (session) {
    // No valid whiteboard token, but user has a web session. Verify they can
    // access assets for this specific meeting, including recap/export views
    // after the active whiteboard token has expired.
    const allowed = await canAccessMeetingTranscriptData(db, meetingId, session.userId);
    if (!allowed) {
      return new Response("Forbidden", { status: 403 });
    }
  } else {
    // No whiteboard token and no web session
    if (tokenStatus === "missing") {
      return new Response("Unauthorized", { status: 401 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  const ifNoneMatch = request.headers.get("If-None-Match");

  const object = await bucket.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  if (ifNoneMatch && object.httpEtag && ifNoneMatch === object.httpEtag) {
    return new Response(null, {
      status: 304,
      headers: {
        "ETag": object.httpEtag,
        "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
        "Vary": "Cookie",
      },
    });
  }

  const rawType = object.httpMetadata?.contentType ?? "application/octet-stream";
  const contentType = SAFE_CONTENT_TYPES.has(rawType)
    ? rawType
    : "application/octet-stream";

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  headers.set("Cache-Control", "private, no-cache, max-age=0, must-revalidate");
  headers.set("Vary", "Cookie");
  headers.set("Content-Length", String(object.size));

  if (object.httpEtag) {
    headers.set("ETag", object.httpEtag);
  }
  if (object.uploaded instanceof Date) {
    headers.set("Last-Modified", object.uploaded.toUTCString());
  }

  return new Response(object.body, { headers });
}
