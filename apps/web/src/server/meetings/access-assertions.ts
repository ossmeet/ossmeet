import type { Database } from "@ossmeet/db";
import { meetingSessions, meetingParticipants, spaceMembers } from "@ossmeet/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { CURRENT_MEETING_PARTICIPANT_STATUSES, Errors } from "@ossmeet/shared";

interface AssertMeetingOptions {
  requireActive?: boolean;
}

interface AssertActiveMeetingParticipantOptions {
  requireSpaceMembership?: boolean;
}

export async function assertMeetingExists(
  db: Database,
  meetingId: string,
  { requireActive = true }: AssertMeetingOptions = {},
) {
  const meeting = await db.query.meetingSessions.findFirst({
    where: requireActive
      ? and(eq(meetingSessions.id, meetingId), eq(meetingSessions.status, "active"))
      : eq(meetingSessions.id, meetingId),
  });
  if (!meeting) throw Errors.NOT_FOUND("Meeting");
  return meeting;
}

export async function assertSpaceMembership(
  db: Database,
  spaceId: string,
  userId: string,
) {
  const membership = await db.query.spaceMembers.findFirst({
    where: and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)),
  });
  if (!membership) throw Errors.FORBIDDEN();
  return membership;
}

export async function assertSpaceMembershipIfNeeded(
  db: Database,
  spaceId: string | null,
  userId: string,
) {
  if (!spaceId) return null;
  return assertSpaceMembership(db, spaceId, userId);
}

export async function assertActiveMeetingParticipant(
  db: Database,
  meetingId: string,
  userId: string,
) {
  const participant = await db.query.meetingParticipants.findFirst({
    where: and(
      eq(meetingParticipants.sessionId, meetingId),
      eq(meetingParticipants.userId, userId),
      inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
    ),
  });
  if (!participant) throw Errors.FORBIDDEN();
  return participant;
}

export async function assertActiveMeetingParticipantWithSpaceAccess(
  db: Database,
  meetingId: string,
  userId: string,
  { requireSpaceMembership = true }: AssertActiveMeetingParticipantOptions = {},
) {
  const meeting = await assertMeetingExists(db, meetingId, { requireActive: true });
  const participant = await assertActiveMeetingParticipant(db, meeting.id, userId);
  if (requireSpaceMembership) {
    await assertSpaceMembershipIfNeeded(db, meeting.spaceId, userId);
  }
  return { meeting, participant };
}
