import { createServerFn } from "@tanstack/react-start";
import type { Database } from "@ossmeet/db";
import { transcripts, meetingParticipants } from "@ossmeet/db/schema";
import {
  CURRENT_MEETING_PARTICIPANT_STATUSES,
  chunkArrayForD1Parameters,
  generateId,
} from "@ossmeet/shared";
import { and, eq, inArray } from "drizzle-orm";
import { withD1Retry } from "@/lib/db-utils";
import { z } from "zod";
import { authMiddleware } from "../middleware";

const segmentSchema = z.object({
  text: z.string().min(1).max(2000),
  participantIdentity: z.string().min(1),
  participantName: z.string().min(1),
  startedAt: z.number().int().positive(),
  language: z.string().min(1).max(64).optional(),
  clientSegmentId: z.string().min(1).max(200).optional(),
});

const saveSegmentsSchema = z.object({
  sessionId: z.string().min(1),
  segments: z.array(segmentSchema).min(1).max(100),
});

const TRANSCRIPT_INSERT_BOUND_PARAMETERS_PER_ROW = 10;

export function buildTrustedTranscriptRows(
  sessionId: string,
  participant: {
    id: string;
    displayName: string;
    livekitIdentity: string | null;
    userId: string | null;
  },
  fallbackUserId: string,
  segments: Array<{ text: string; startedAt: number; language?: string; clientSegmentId?: string; participantIdentity?: string; participantName?: string }>,
) {
  const now = new Date();
  const defaultIdentity = participant.livekitIdentity ?? participant.userId ?? fallbackUserId;
  const defaultName = participant.displayName;
  return segments.map((seg, idx) => {
    const identity = seg.participantIdentity ?? defaultIdentity;
    const name = seg.participantName ?? defaultName;
    return {
      id: generateId("TRANSCRIPT"),
      sessionId,
      participantId: participant.id,
      participantIdentity: identity,
      participantName: name,
      text: seg.text,
      // segmentId is NOT NULL — generate a deterministic placeholder when the speech API omits it
      // so the UNIQUE constraint still prevents duplicates on re-submission of the same batch.
      segmentId: seg.clientSegmentId
        ? `client:${sessionId}:${seg.clientSegmentId}`
        : `auto:${sessionId}:${identity}:${seg.startedAt}:${idx}`,
      language: seg.language ?? null,
      startedAt: new Date(seg.startedAt),
      updatedAt: now,
    };
  });
}

export async function findActiveMeetingParticipant(
  db: Database,
  meetingId: string,
  userId: string,
) {
  return (
    await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.sessionId, meetingId),
        eq(meetingParticipants.userId, userId),
        inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
      ),
    })
  ) ?? null;
}

/**
 * Persist Web Speech API final transcript segments to D1.
 * Uses the same `transcripts` table as the LiveKit server-side agent,
 * so note generation works regardless of which source produced the text.
 *
 * Auth-guarded: guests and unauthenticated users return { saved: 0 }
 * without error so the client buffer silently no-ops for them.
 */
export const saveTranscriptSegments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(saveSegmentsSchema)
  .handler(async ({ data, context: { user, db } }) => {
    // Verify the caller is an actual participant in this meeting
    const participant = await findActiveMeetingParticipant(
      db,
      data.sessionId,
      user.id
    );
    if (!participant) return { saved: 0 };

    const rows = buildTrustedTranscriptRows(
      data.sessionId,
      participant,
      user.id,
      data.segments.map((seg) => ({
        text: seg.text,
        startedAt: seg.startedAt,
        language: seg.language,
        clientSegmentId: seg.clientSegmentId,
        participantIdentity: seg.participantIdentity,
        participantName: seg.participantName,
      })),
    );

    for (const chunk of chunkArrayForD1Parameters(rows, TRANSCRIPT_INSERT_BOUND_PARAMETERS_PER_ROW)) {
      await withD1Retry(() => db.insert(transcripts).values(chunk).onConflictDoNothing());
    }
    return { saved: rows.length };
  });
