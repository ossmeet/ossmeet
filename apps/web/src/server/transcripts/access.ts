import type { Database } from "@ossmeet/db";
import { meetingParticipants, meetingSessions, spaceMembers } from "@ossmeet/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { CURRENT_MEETING_PARTICIPANT_STATUSES } from "@ossmeet/shared";

export async function canAccessMeetingTranscriptData(
  db: Database,
  meetingId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      hostId: meetingSessions.hostId,
      spaceId: meetingSessions.spaceId,
      participantId: meetingParticipants.id,
      memberId: spaceMembers.id,
    })
    .from(meetingSessions)
    .leftJoin(
      meetingParticipants,
      and(
        eq(meetingParticipants.sessionId, meetingId),
        eq(meetingParticipants.userId, userId),
      ),
    )
    .leftJoin(
      spaceMembers,
      and(
        eq(spaceMembers.spaceId, meetingSessions.spaceId),
        eq(spaceMembers.userId, userId),
      ),
    )
    .where(eq(meetingSessions.id, meetingId))
    .limit(1);

  if (!row) return false;

  const isHost = row.hostId === userId;
  if (!isHost && !row.participantId) return false;
  if (!row.spaceId) return true;
  return !!row.memberId;
}

export async function canAccessActiveMeetingAssets(
  db: Database,
  meetingId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      hostId: meetingSessions.hostId,
      spaceId: meetingSessions.spaceId,
      participantId: meetingParticipants.id,
      memberId: spaceMembers.id,
    })
    .from(meetingSessions)
    .leftJoin(
      meetingParticipants,
      and(
        eq(meetingParticipants.sessionId, meetingId),
        eq(meetingParticipants.userId, userId),
        inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
      ),
    )
    .leftJoin(
      spaceMembers,
      and(
        eq(spaceMembers.spaceId, meetingSessions.spaceId),
        eq(spaceMembers.userId, userId),
      ),
    )
    .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.status, "active")))
    .limit(1);

  if (!row) return false;
  if (row.hostId !== userId && !row.participantId) return false;
  if (!row.spaceId) return true;
  return !!row.memberId;
}
