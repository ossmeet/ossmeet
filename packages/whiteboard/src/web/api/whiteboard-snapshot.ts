import { createDb } from "@ossmeet/db";
import { meetingArtifacts, meetingSessions } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { registerMeetingArtifactMetadata } from "@/server/assets/register";
import { whiteboardStateKey } from "@/lib/r2-key";
import { logError, logInfo } from "@/lib/logger";
import { RequestBodyTooLargeError, readRequestBodyBytes } from "@/server/request-body";
import { timingSafeEqual } from "../../lib/crypto-utils";

const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024; // 50 MB
const MEETING_ID_RE = /^[a-zA-Z0-9_-]+$/;
const snapshotPayloadSchema = z.object({
  sessionId: z.string().regex(/^meet-[a-zA-Z0-9_-]+$/),
  snapshot: z.record(z.string(), z.unknown()),
}).strict();

async function verifySnapshotSecret(request: Request, env: Env): Promise<Response | null> {
  if (!env.WHITEBOARD_INTERNAL_SECRET) {
    return new Response("Not found", { status: 404 });
  }

  const secret = request.headers.get("X-Whiteboard-Secret") ?? "";
  if (!(await timingSafeEqual(secret, env.WHITEBOARD_INTERNAL_SECRET))) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

function parseSnapshotSessionId(raw: string | null): string | Response {
  if (!raw || !/^meet-[a-zA-Z0-9_-]+$/.test(raw)) {
    return new Response("Invalid sessionId", { status: 400 });
  }
  return raw;
}

export async function handleSnapshot(request: Request, env: Env): Promise<Response> {
  const unauthorized = await verifySnapshotSecret(request, env);
  if (unauthorized) return unauthorized;

  let bodyBytes: Uint8Array;
  try {
    bodyBytes = await readRequestBodyBytes(request, MAX_SNAPSHOT_BYTES);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return new Response("Payload too large", { status: 413 });
    }
    throw err;
  }

  if (bodyBytes.byteLength === 0) {
    return new Response("Invalid JSON", { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bodyBytes)) as unknown;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (bodyBytes.byteLength > MAX_SNAPSHOT_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  const parsed = snapshotPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return new Response("Invalid body", { status: 400 });
  }
  const { sessionId, snapshot } = parsed.data;

  const meetingId = sessionId.slice("meet-".length);
  if (!meetingId || !MEETING_ID_RE.test(meetingId)) {
    return new Response("Invalid meetingId", { status: 400 });
  }

  const snapshotJson = JSON.stringify(snapshot);
  const snapshotBytes = new TextEncoder().encode(snapshotJson);
  if (snapshotBytes.byteLength > MAX_SNAPSHOT_BYTES) {
    logError(`[wb-snapshot] Snapshot for ${meetingId} exceeds limit (${snapshotBytes.byteLength} bytes)`);
    return new Response("Payload too large", { status: 413 });
  }

  const r2Key = whiteboardStateKey(meetingId);

  try {
    const db = createDb(env.DB);
    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, meetingId),
      columns: { id: true, hostId: true, spaceId: true },
    });
    if (!meeting) {
      return new Response("Meeting not found", { status: 404 });
    }

    const existingArtifact = await db.query.meetingArtifacts.findFirst({
      where: eq(meetingArtifacts.r2Key, r2Key),
      columns: { id: true },
    });

    await env.R2_BUCKET.put(r2Key, snapshotJson, {
      httpMetadata: { contentType: "application/json" },
    });

    try {
      await registerMeetingArtifactMetadata(db, {
        spaceId: meeting.spaceId,
        meetingId: meeting.id,
        type: "whiteboard_state",
        r2Key,
        filename: "snapshot.json",
        mimeType: "application/json",
        size: snapshotBytes.byteLength,
        uploadedById: meeting.hostId,
      });
    } catch (err) {
      if (!existingArtifact) {
        await env.R2_BUCKET.delete(r2Key).catch((deleteErr: unknown) => {
          logError(`[wb-snapshot] Failed to roll back snapshot object for ${meetingId}:`, deleteErr);
        });
      }
      throw err;
    }

    logInfo(`[wb-snapshot] Saved snapshot for meeting ${meetingId}`);
    return new Response("OK", { status: 200 });
  } catch (err) {
    logError(`[wb-snapshot] Failed to save snapshot for ${meetingId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
}

export async function handleSnapshotFetch(request: Request, env: Env): Promise<Response> {
  const unauthorized = await verifySnapshotSecret(request, env);
  if (unauthorized) return unauthorized;

  const parsedSessionId = parseSnapshotSessionId(new URL(request.url).searchParams.get("sessionId"));
  if (parsedSessionId instanceof Response) return parsedSessionId;

  const meetingId = parsedSessionId.slice("meet-".length);
  if (!meetingId || !MEETING_ID_RE.test(meetingId)) {
    return new Response("Invalid meetingId", { status: 400 });
  }

  try {
    const db = createDb(env.DB);
    const artifact = await db.query.meetingArtifacts.findFirst({
      where: eq(meetingArtifacts.r2Key, whiteboardStateKey(meetingId)),
      columns: { r2Key: true },
    });
    if (!artifact) return new Response(null, { status: 204 });

    const object = await env.R2_BUCKET.get(artifact.r2Key);
    if (!object) return new Response(null, { status: 204 });

    if (object.size > MAX_SNAPSHOT_BYTES) {
      logError(`[wb-snapshot] Stored snapshot for ${meetingId} exceeds limit (${object.size} bytes)`);
      return new Response("Snapshot too large", { status: 413 });
    }

    return new Response(object.body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logError(`[wb-snapshot] Failed to fetch snapshot for ${meetingId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
}
