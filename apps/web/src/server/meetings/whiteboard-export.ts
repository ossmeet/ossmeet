import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { meetingArtifacts, rooms, meetingSessions } from "@ossmeet/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { Errors } from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import { buildR2Client } from "../upload";
import { canAccessMeetingTranscriptData } from "../transcripts/access";

async function assertExportAccess(
  db: import("@ossmeet/db").Database,
  meetingId: string,
  userId: string,
) {
  const allowed = await canAccessMeetingTranscriptData(db, meetingId, userId);
  if (!allowed) throw Errors.FORBIDDEN();
}

// ─── getWhiteboardSnapshot ────────────────────────────────────────────
// Returns the whiteboard snapshot JSON so the browser can hydrate an editor
// and export to PDF. Only participants of the meeting can access it.

export const getWhiteboardSnapshot = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ sessionId: z.string().min(1) }))
  .handler(async ({ data, context: { user, db, env } }) => {
    await assertExportAccess(db, data.sessionId, user.id);

    const snapshotArtifact = await db.query.meetingArtifacts.findFirst({
      where: and(
        eq(meetingArtifacts.sessionId, data.sessionId),
        eq(meetingArtifacts.type, "whiteboard_state"),
      ),
      columns: { r2Key: true },
      orderBy: [desc(meetingArtifacts.createdAt), desc(meetingArtifacts.id)],
    });

    if (!snapshotArtifact) {
      return { snapshot: null };
    }

    const object = await env.R2_BUCKET.get(snapshotArtifact.r2Key);
    if (!object) return { snapshot: null };

    const snapshot = await object.json();
    return { snapshot };
  });

// ─── getWhiteboardPdfDownloadUrl ──────────────────────────────────────
// Returns a short-lived presigned R2 download URL for the exported PDF.

export const getWhiteboardPdfDownloadUrl = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ sessionId: z.string().min(1) }))
  .handler(async ({ data, context: { user, db, env } }) => {
    await assertExportAccess(db, data.sessionId, user.id);

    const artifact = await db.query.meetingArtifacts.findFirst({
      where: and(
        eq(meetingArtifacts.sessionId, data.sessionId),
        eq(meetingArtifacts.type, "whiteboard_pdf"),
      ),
      columns: { r2Key: true },
      orderBy: [desc(meetingArtifacts.createdAt), desc(meetingArtifacts.id)],
    });

    const meeting = await db
      .select({
        title: meetingSessions.title,
        code: rooms.code,
      })
      .from(meetingSessions)
      .innerJoin(rooms, eq(meetingSessions.roomId, rooms.id))
      .where(eq(meetingSessions.id, data.sessionId))
      .get();

    if (!artifact || !meeting) throw Errors.NOT_FOUND("Whiteboard PDF");

    if (!env.R2_BUCKET_NAME) throw Errors.CONFIG_ERROR("Storage not configured");

    const { r2, endpoint } = buildR2Client(env);
    const url = new URL(`/${env.R2_BUCKET_NAME}/${artifact.r2Key}`, endpoint);
    url.searchParams.set("X-Amz-Expires", "300");

    const filename = `whiteboard-${meeting.title ?? meeting.code}.pdf`;
    url.searchParams.set(
      "response-content-disposition",
      `attachment; filename="${filename.replace(/"/g, "")}"`,
    );

    const signed = await r2.sign(
      new Request(url.toString(), { method: "GET" }),
      { aws: { signQuery: true } },
    );

    return { downloadUrl: signed.url };
  });
