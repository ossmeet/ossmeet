import { createDb } from "@ossmeet/db";
import { meetingArtifacts, meetingSessions } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { verifySessionFromRawRequest } from "@/server/auth/helpers";
import { registerMeetingArtifactMetadata } from "@/server/assets/register";
import { whiteboardExportPdfKey } from "@/lib/r2-key";
import { logError } from "@/lib/logger";
import { RequestBodyTooLargeError, readRequestBodyBytes } from "@/server/request-body";

const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB
const MEETING_ID_RE = /^[a-zA-Z0-9_-]+$/;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export async function handlePdfUpload(request: Request, env: Env): Promise<Response> {
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

  let bytes: Uint8Array;
  try {
    bytes = await readRequestBodyBytes(request, MAX_PDF_BYTES);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return new Response("PDF too large", { status: 413 });
    }
    throw err;
  }

  if (bytes.byteLength === 0) return new Response("Empty body", { status: 400 });
  const isPdf = PDF_SIGNATURE.every((byte, idx) => bytes[idx] === byte);
  if (!isPdf) return new Response("Invalid PDF file", { status: 400 });

  const r2Key = whiteboardExportPdfKey(meetingId);

  try {
    const existingArtifact = await db.query.meetingArtifacts.findFirst({
      where: eq(meetingArtifacts.r2Key, r2Key),
      columns: { id: true },
    });

    await env.R2_BUCKET.put(r2Key, bytes, {
      httpMetadata: { contentType: "application/pdf" },
    });

    try {
      await registerMeetingArtifactMetadata(db, {
        spaceId: meeting.spaceId,
        meetingId: meeting.id,
        type: "whiteboard_pdf",
        r2Key,
        filename: "whiteboard-export.pdf",
        mimeType: "application/pdf",
        size: bytes.byteLength,
        uploadedById: meeting.hostId,
      });
    } catch (err) {
      if (!existingArtifact) {
        await env.R2_BUCKET.delete(r2Key).catch((deleteErr: unknown) => {
          logError(`[wb-pdf-upload] Failed to roll back PDF for ${meetingId}:`, deleteErr);
        });
      }
      throw err;
    }

    return Response.json({ r2Key });
  } catch (err) {
    logError(`[wb-pdf-upload] Failed to save PDF for ${meetingId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
}
