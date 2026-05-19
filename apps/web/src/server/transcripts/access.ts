import type { Database } from "@ossmeet/db";
import { meetingAdmissions, meetingLivekitPresences, meetingSessions, spaceMembers } from "@ossmeet/db/schema";
import { and, eq } from "drizzle-orm";

export async function canAccessMeetingTranscriptData(
  db: Database,
  meetingId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      hostId: meetingSessions.hostId,
      spaceId: meetingSessions.spaceId,
      admissionId: meetingAdmissions.id,
      memberId: spaceMembers.id,
    })
    .from(meetingSessions)
    .leftJoin(
      meetingAdmissions,
      and(
        eq(meetingAdmissions.sessionId, meetingId),
        eq(meetingAdmissions.subjectUserId, userId),
        eq(meetingAdmissions.admissionStatus, "approved"),
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
  if (!isHost && !row.admissionId) return false;
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
      admissionId: meetingLivekitPresences.id,
      memberId: spaceMembers.id,
    })
    .from(meetingSessions)
    .leftJoin(
      meetingLivekitPresences,
      and(
        eq(meetingLivekitPresences.sessionId, meetingId),
        eq(meetingLivekitPresences.userId, userId),
        eq(meetingLivekitPresences.presenceStatus, "connected"),
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
  if (row.hostId !== userId && !row.admissionId) return false;
  if (!row.spaceId) return true;
  return !!row.memberId;
}
