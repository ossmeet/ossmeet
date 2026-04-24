import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "@ossmeet/db";
import { meetingSessions } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { getEnvFromRequest, verifySessionFromRawRequest } from "@/server/auth/helpers";
import { registerMeetingArtifactMetadata } from "@/server/assets/register";
import { whiteboardExportPdfKey } from "@/lib/r2-key";
import { logError } from "@/lib/logger";

const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB
const MEETING_ID_RE = /^[a-zA-Z0-9_-]+$/;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export const Route = createFileRoute("/api/whiteboard/pdf-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = await getEnvFromRequest(request);
        if (!env) return new Response("Server configuration error", { status: 500 });

        const session = await verifySessionFromRawRequest(request, env);
        if (!session) return new Response("Unauthorized", { status: 401 });

        const url = new URL(request.url);
        const meetingId = url.searchParams.get("meetingId") ?? "";
        if (!meetingId || !MEETING_ID_RE.test(meetingId)) {
          return new Response("Invalid meetingId", { status: 400 });
        }

        const db = createDb(env.DB);
        const meeting = await db.query.meetingSessions.findFirst({
          where: eq(meetingSessions.id, meetingId),
          columns: { id: true, hostId: true, spaceId: true },
        });
        if (!meeting) return new Response("Meeting not found", { status: 404 });

        if (meeting.hostId !== session.userId) {
          return new Response("Forbidden", { status: 403 });
        }

        const contentLength = Number(request.headers.get("Content-Length") ?? 0);
        if (contentLength > MAX_PDF_BYTES) {
          return new Response("PDF too large", { status: 413 });
        }

        const body = await request.arrayBuffer();
        if (body.byteLength === 0) return new Response("Empty body", { status: 400 });
        if (body.byteLength > MAX_PDF_BYTES) return new Response("PDF too large", { status: 413 });
        const bytes = new Uint8Array(body);
        const isPdf = PDF_SIGNATURE.every((byte, idx) => bytes[idx] === byte);
        if (!isPdf) return new Response("Invalid PDF file", { status: 400 });

        const r2Key = whiteboardExportPdfKey(meetingId);

        try {
          await env.R2_BUCKET.put(r2Key, body, {
            httpMetadata: { contentType: "application/pdf" },
          });

          await registerMeetingArtifactMetadata(db, {
            spaceId: meeting.spaceId,
            meetingId: meeting.id,
            type: "whiteboard_pdf",
            r2Key,
            filename: "whiteboard-export.pdf",
            mimeType: "application/pdf",
            size: body.byteLength,
            uploadedById: meeting.hostId,
          });

          return Response.json({ r2Key });
        } catch (err) {
          logError(`[wb-pdf-upload] Failed to save PDF for ${meetingId}:`, err);
          return new Response("Internal error", { status: 500 });
        }
      },
    },
  },
});
