import { createServerFn } from "@tanstack/react-start";
import {
  meetingAdmissions,
  meetingArtifacts,
  meetingSessions,
  meetingSummaries,
  rooms,
} from "@ossmeet/db/schema";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { authMiddleware } from "../middleware";
import { Errors } from "@ossmeet/shared";
import { canAccessMeetingTranscriptData } from "./access";
import { listTranscriptRows } from "./query";

const roomCodeSchema = z.object({ code: z.string().min(1) });

async function resolveLatestAccessibleSession(
  db: import("@ossmeet/db").Database,
  code: string,
  userId: string,
) {
  const rows = await db
    .select({
      sessionId: meetingSessions.id,
      sessionSlug: meetingSessions.publicSlug,
      title: meetingSessions.title,
      startedAt: meetingSessions.startedAt,
      endedAt: meetingSessions.endedAt,
      isHost: meetingSessions.hostId,
    })
    .from(meetingSessions)
    .innerJoin(rooms, eq(meetingSessions.roomId, rooms.id))
    .leftJoin(
      meetingAdmissions,
      and(
        eq(meetingAdmissions.sessionId, meetingSessions.id),
        eq(meetingAdmissions.subjectUserId, userId),
        eq(meetingAdmissions.admissionStatus, "approved"),
      ),
    )
    .where(
      and(
        eq(rooms.code, code),
        eq(meetingSessions.status, "ended"),
        or(eq(meetingSessions.hostId, userId), eq(meetingAdmissions.subjectUserId, userId)),
      ),
    )
    .orderBy(desc(meetingSessions.startedAt))
    .limit(1);

    const session = rows[0] ?? null;
    if (!session) return null;

    const artifactRows = await db
      .select({ type: meetingArtifacts.type })
      .from(meetingArtifacts)
      .where(eq(meetingArtifacts.sessionId, session.sessionId));

    const artifactTypes = new Set(artifactRows.map((artifact) => artifact.type));

    return {
      ...session,
      isHost: session.isHost === userId,
      hasWhiteboardState: artifactTypes.has("whiteboard_state"),
      hasWhiteboardPdf: artifactTypes.has("whiteboard_pdf"),
    };
  }

export const getRoomLatestSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(roomCodeSchema)
  .handler(async ({ data, context: { user, db } }) => {
    const session = await resolveLatestAccessibleSession(db, data.code, user.id);
    if (!session) return { session: null, summary: null };

    const allowed = await canAccessMeetingTranscriptData(db, session.sessionId, user.id);
    if (!allowed) throw Errors.FORBIDDEN();

    const row = await db
      .select({
        id: meetingSummaries.id,
        summary: meetingSummaries.summary,
        topics: meetingSummaries.topics,
        actionItems: meetingSummaries.actionItems,
        decisions: meetingSummaries.decisions,
        durationSeconds: meetingSummaries.durationSeconds,
        participantCount: meetingSummaries.participantCount,
        createdAt: meetingSummaries.createdAt,
      })
      .from(meetingSummaries)
      .where(eq(meetingSummaries.sessionId, session.sessionId))
      .orderBy(desc(meetingSummaries.createdAt))
      .get();

    return {
      session,
      summary: row
        ? {
            ...row,
            topics: row.topics ?? [],
            actionItems: row.actionItems ?? [],
            decisions: row.decisions ?? [],
          }
        : null,
    };
  });

export const getRoomLatestTranscripts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(roomCodeSchema)
  .handler(async ({ data, context: { user, db } }) => {
    const session = await resolveLatestAccessibleSession(db, data.code, user.id);
    if (!session) return { transcripts: [] };

    const allowed = await canAccessMeetingTranscriptData(db, session.sessionId, user.id);
    if (!allowed) throw Errors.FORBIDDEN();

    const transcripts = await listTranscriptRows(db, session.sessionId);
    return { transcripts };
  });
