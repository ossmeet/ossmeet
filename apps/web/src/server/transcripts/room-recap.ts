import { createServerFn } from "@tanstack/react-start";
import { meetingSessions, meetingSummaries, meetingParticipants, rooms, transcripts } from "@ossmeet/db/schema";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { authMiddleware } from "../middleware";
import { Errors } from "@ossmeet/shared";
import { canAccessMeetingTranscriptData } from "./access";
import type { ArchivedTranscriptRow } from "./archive";

const ARCHIVE_MODULE = "./archive";
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
    })
    .from(meetingSessions)
    .innerJoin(rooms, eq(meetingSessions.roomId, rooms.id))
    .leftJoin(
      meetingParticipants,
      and(eq(meetingParticipants.sessionId, meetingSessions.id), eq(meetingParticipants.userId, userId)),
    )
    .where(
      and(
        eq(rooms.code, code),
        eq(meetingSessions.status, "ended"),
        or(eq(meetingSessions.hostId, userId), eq(meetingParticipants.userId, userId)),
      ),
    )
    .orderBy(desc(meetingSessions.startedAt))
    .limit(1);

  return rows[0] ?? null;
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
  .handler(async ({ data, context: { user, db, env } }) => {
    const { loadTranscriptArchiveFromR2 } = await import(/* @vite-ignore */ ARCHIVE_MODULE);
    const session = await resolveLatestAccessibleSession(db, data.code, user.id);
    if (!session) return { transcripts: [] };

    const allowed = await canAccessMeetingTranscriptData(db, session.sessionId, user.id);
    if (!allowed) throw Errors.FORBIDDEN();

    const rows = await db
      .select({
        id: transcripts.id,
        participantIdentity: transcripts.participantIdentity,
        participantName: transcripts.participantName,
        text: transcripts.text,
        language: transcripts.language,
        startedAt: transcripts.startedAt,
      })
      .from(transcripts)
      .where(eq(transcripts.sessionId, session.sessionId))
      .orderBy(transcripts.startedAt)
      .limit(10_000)
      .all();

    if (rows.length > 0) return { transcripts: rows };

    const archived = await loadTranscriptArchiveFromR2(env, session.sessionId);
    if (archived && archived.length > 0) {
      return {
        transcripts: archived.map((row: ArchivedTranscriptRow) => ({
          id: row.id,
          participantIdentity: row.participantIdentity,
          participantName: row.participantName,
          text: row.text,
          language: row.language,
          startedAt: new Date(row.startedAt),
        })),
      };
    }

    return { transcripts: rows };
  });
