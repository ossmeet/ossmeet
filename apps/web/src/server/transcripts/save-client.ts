import { createServerFn } from "@tanstack/react-start";
import { createDb, type Database } from "@ossmeet/db";
import { meetingAdmissions, meetingLivekitPresences, transcripts, meetingSessions } from "@ossmeet/db/schema";
import {
  AppError,
  Errors,
  chunkArrayForD1Parameters,
  generateId,
} from "@ossmeet/shared";
import { and, eq, inArray } from "drizzle-orm";
import { withD1Retry } from "@/lib/db-utils";
import { z } from "zod";
import { assertSpaceMembershipIfNeeded } from "../meetings/access-assertions";
import { findConnectedPresenceByUserId } from "../meetings/presence-queries";

const AUTH_HELPERS_MODULE = "../auth/helpers";

const segmentSchema = z.object({
  text: z.string().min(1).max(2000),
  startedAt: z.number().int().positive(),
  language: z.string().min(1).max(64).optional(),
  clientSegmentId: z.string().min(1).max(200).optional(),
});

const saveSegmentsSchema = z.object({
  sessionId: z.string().min(1),
  admissionId: z.string().min(1).optional(),
  connectionId: z.string().min(1).optional(),
  segments: z.array(segmentSchema).min(1).max(100),
});

const TRANSCRIPT_INSERT_BOUND_PARAMETERS_PER_ROW = 11;

export function buildTrustedTranscriptRows(
  sessionId: string,
  participant: {
    admissionId: string | null;
    connectionId: string | null;
    displayName: string;
    livekitIdentity: string;
    userId: string | null;
  },
  fallbackUserId: string,
  segments: Array<{ text: string; startedAt: number; language?: string; clientSegmentId?: string }>,
) {
  const now = new Date();
  const identity = participant.livekitIdentity ?? participant.userId ?? fallbackUserId;
  const name = participant.displayName;
  return segments.map((seg, idx) => {
    return {
      id: generateId("TRANSCRIPT"),
      sessionId,
      admissionId: participant.admissionId,
      connectionId: participant.connectionId,
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
  const presence = await findConnectedPresenceByUserId(db, meetingId, userId);
  if (!presence) return null;

  const admission = await db.query.meetingAdmissions.findFirst({
    where: eq(meetingAdmissions.id, presence.admissionId),
    columns: {
      id: true,
      displayName: true,
    },
  });
  if (!admission) return null;

  return {
    admissionId: admission.id,
    connectionId: presence.connectionId,
    displayName: admission.displayName,
    livekitIdentity: presence.livekitIdentity,
    userId: presence.userId,
  };
}

export async function findActiveMeetingParticipantWithSpaceAccess(
  db: Database,
  meetingId: string,
  userId: string,
) {
  const participant = await findActiveMeetingParticipant(db, meetingId, userId);
  if (!participant) return null;

  const meeting = await db.query.meetingSessions.findFirst({
    where: eq(meetingSessions.id, meetingId),
    columns: { spaceId: true },
  });
  if (!meeting) return null;

  try {
    await assertSpaceMembershipIfNeeded(db, meeting.spaceId, userId);
  } catch {
    return null;
  }

  return participant;
}

export async function findActiveGuestMeetingParticipant(
  db: Database,
  meetingId: string,
  admissionId: string,
  connectionId: string,
) {
  const connection = await db.query.meetingLivekitPresences.findFirst({
    where: and(
      eq(meetingLivekitPresences.id, connectionId),
      eq(meetingLivekitPresences.sessionId, meetingId),
      eq(meetingLivekitPresences.admissionId, admissionId),
      inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued"]),
    ),
    columns: {
      id: true,
      admissionId: true,
      livekitIdentity: true,
      userId: true,
      role: true,
    },
  });
  if (!connection || connection.userId || connection.role !== "guest") return null;

  const admission = await db.query.meetingAdmissions.findFirst({
    where: eq(meetingAdmissions.id, admissionId),
    columns: {
      id: true,
      displayName: true,
      subjectType: true,
      subjectUserId: true,
      admissionStatus: true,
    },
  });
  if (
    !admission ||
    admission.subjectType !== "guest" ||
    admission.subjectUserId ||
    admission.admissionStatus !== "approved"
  ) {
    return null;
  }

  return {
    admissionId: admission.id,
    connectionId: connection.id,
    displayName: admission.displayName,
    livekitIdentity: connection.livekitIdentity,
    userId: null,
  };
}

/**
 * Persist Web Speech API final transcript segments to D1.
 *
 * Authenticated users are resolved through the active presence row. Guests are
 * resolved through the HttpOnly guest admission cookie plus their active
 * connection/admission IDs. In both cases the server owns speaker identity.
 */
export const saveTranscriptSegments = createServerFn({ method: "POST" })
  .inputValidator(saveSegmentsSchema)
  .handler(async ({ data }) => {
    const { getEnv, requireAuth, verifyGuestAdmission } =
      await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    const env = await getEnv();
    const db = createDb(env.DB);

    let fallbackUserId = "guest";
    let participant: Awaited<ReturnType<typeof findActiveMeetingParticipantWithSpaceAccess>> | null = null;

    try {
      const user = await requireAuth();
      fallbackUserId = user.id;
      participant = await findActiveMeetingParticipantWithSpaceAccess(
        db,
        data.sessionId,
        user.id,
      );
    } catch (err) {
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;
      if (!data.admissionId || !data.connectionId) throw Errors.UNAUTHORIZED();
      await verifyGuestAdmission(db, data.sessionId, data.admissionId);
      participant = await findActiveGuestMeetingParticipant(
        db,
        data.sessionId,
        data.admissionId,
        data.connectionId,
      );
      fallbackUserId = data.admissionId;
    }
    if (!participant) return { saved: 0 };

    const rows = buildTrustedTranscriptRows(
      data.sessionId,
      participant,
      fallbackUserId,
      data.segments.map((seg) => ({
        text: seg.text,
        startedAt: seg.startedAt,
        language: seg.language,
        clientSegmentId: seg.clientSegmentId,
      })),
    );

    for (const chunk of chunkArrayForD1Parameters(rows, TRANSCRIPT_INSERT_BOUND_PARAMETERS_PER_ROW)) {
      await withD1Retry(() => db.insert(transcripts).values(chunk).onConflictDoNothing());
    }
    return { saved: rows.length };
  });
