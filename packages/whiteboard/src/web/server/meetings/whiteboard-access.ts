import type { Database } from "@ossmeet/db";
import { assertMeetingExists, assertSpaceMembershipIfNeeded } from "@/server/meetings/access-assertions";
import {
  findWhiteboardEligiblePresenceByConnectionId,
  findWhiteboardEligiblePresenceByAdmissionId,
} from "@/server/meetings/presence-queries";

export type WhiteboardAccessRole = "host" | "participant" | "guest";

export interface ActiveWhiteboardParticipantAccess {
  meetingId: string;
  connectionId: string;
  admissionId: string | null;
  participantIdentity: string;
  userId: string | null;
  role: WhiteboardAccessRole;
}

export async function getActiveWhiteboardParticipantAccess(
  db: Database,
  meetingId: string,
  connectionId: string,
): Promise<ActiveWhiteboardParticipantAccess | null> {
  const meeting = await assertMeetingExists(db, meetingId, { requireActive: true });
  const normalizedConnectionId = connectionId.trim();
  if (!normalizedConnectionId) return null;
  const participant = await findWhiteboardEligiblePresenceByConnectionId(db, meetingId, normalizedConnectionId);

  if (!participant) {
    return null;
  }

  if (participant.userId) {
    try {
      await assertSpaceMembershipIfNeeded(db, meeting.spaceId, participant.userId);
    } catch {
      return null;
    }
  }

  const role: WhiteboardAccessRole =
    participant.userId === null
      ? "guest"
      : participant.userId === meeting.hostId
        ? "host"
        : "participant";

  return {
    meetingId: meeting.id,
    connectionId: participant.connectionId,
    admissionId: participant.admissionId,
    participantIdentity: participant.livekitIdentity,
    userId: participant.userId,
    role,
  };
}

export async function getActiveWhiteboardParticipantAccessByAdmissionId(
  db: Database,
  meetingId: string,
  admissionId: string,
): Promise<ActiveWhiteboardParticipantAccess | null> {
  const meeting = await assertMeetingExists(db, meetingId, { requireActive: true });
  const normalizedAdmissionId = admissionId.trim();
  if (!normalizedAdmissionId) return null;
  const participant = await findWhiteboardEligiblePresenceByAdmissionId(
    db,
    meetingId,
    normalizedAdmissionId,
  );

  if (!participant) return null;

  if (participant.userId) {
    try {
      await assertSpaceMembershipIfNeeded(db, meeting.spaceId, participant.userId);
    } catch {
      return null;
    }
  }

  const role: WhiteboardAccessRole =
    participant.userId === null
      ? "guest"
      : participant.userId === meeting.hostId
        ? "host"
        : "participant";

  return {
    meetingId: meeting.id,
    connectionId: participant.connectionId,
    admissionId: participant.admissionId,
    participantIdentity: participant.livekitIdentity,
    userId: participant.userId,
    role,
  };
}
