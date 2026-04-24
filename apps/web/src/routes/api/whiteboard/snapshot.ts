import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "@ossmeet/db";
import { meetingSessions } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getEnvFromRequest } from "@/server/auth/helpers";
import { registerMeetingArtifactMetadata } from "@/server/assets/register";
import { whiteboardStateKey } from "@/lib/r2-key";
import { logError, logInfo } from "@/lib/logger";

const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024; // 50 MB
const MEETING_ID_RE = /^[a-zA-Z0-9_-]+$/;
const snapshotPayloadSchema = z.object({
  sessionId: z.string().regex(/^meet-[a-zA-Z0-9_-]+$/),
  snapshot: z.record(z.string(), z.unknown()),
}).strict();

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode("k"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const [macA, macB] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const a8 = new Uint8Array(macA), b8 = new Uint8Array(macB);
  let diff = 0;
  for (let i = 0; i < a8.length; i++) diff |= a8[i] ^ b8[i];
  return diff === 0;
}

export const Route = createFileRoute("/api/whiteboard/snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = await getEnvFromRequest(request);
        if (!env?.WHITEBOARD_INTERNAL_SECRET) {
          return new Response("Server configuration error", { status: 500 });
        }

        const secret = request.headers.get("X-Whiteboard-Secret") ?? "";
        if (!(await timingSafeEqual(secret, env.WHITEBOARD_INTERNAL_SECRET))) {
          return new Response("Unauthorized", { status: 401 });
        }

        const contentLength = Number(request.headers.get("Content-Length") ?? 0);
        if (contentLength > MAX_SNAPSHOT_BYTES) {
          return new Response("Payload too large", { status: 413 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
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
        if (snapshotJson.length > MAX_SNAPSHOT_BYTES) {
          logError(`[wb-snapshot] Snapshot for ${meetingId} exceeds limit (${snapshotJson.length} bytes)`);
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

          await env.R2_BUCKET.put(r2Key, snapshotJson, {
            httpMetadata: { contentType: "application/json" },
          });

          await registerMeetingArtifactMetadata(db, {
            spaceId: meeting.spaceId,
            meetingId: meeting.id,
            type: "whiteboard_state",
            r2Key,
            filename: "snapshot.json",
            mimeType: "application/json",
            size: new TextEncoder().encode(snapshotJson).byteLength,
            uploadedById: meeting.hostId,
          });

          logInfo(`[wb-snapshot] Saved snapshot for meeting ${meetingId}`);
          return new Response("OK", { status: 200 });
        } catch (err) {
          logError(`[wb-snapshot] Failed to save snapshot for ${meetingId}:`, err);
          return new Response("Internal error", { status: 500 });
        }
      },
    },
  },
});
