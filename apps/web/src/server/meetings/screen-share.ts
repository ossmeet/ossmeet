import { createServerFn } from "@tanstack/react-start";
import type { Database } from "@ossmeet/db";
import { meetingSessions, meetingParticipants } from "@ossmeet/db/schema";
import { eq, and, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { CURRENT_MEETING_PARTICIPANT_STATUSES, Errors } from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import { updateScreenSharePermission } from "./screen-share.server";

const grantScreenShareSchema = z.object({
  meetingId: z.string(),
  targetIdentity: z.string(),
  allow: z.boolean(),
});

export async function getGrantableMeetingParticipant(
  db: Database,
  meetingId: string,
  targetIdentity: string,
) {
  const participant = await db.query.meetingParticipants.findFirst({
    where: and(
      eq(meetingParticipants.sessionId, meetingId),
      inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
      or(
        eq(meetingParticipants.livekitIdentity, targetIdentity),
        eq(meetingParticipants.userId, targetIdentity),
      ),
    ),
    columns: {
      id: true,
      userId: true,
      livekitIdentity: true,
    },
  });

  if (!participant) {
    throw Errors.NOT_FOUND("Participant");
  }

  return participant;
}

export const grantScreenShare = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(grantScreenShareSchema)
  .handler(async ({ data, context: { user, env, db } }) => {
    const meeting = await db.query.meetingSessions.findFirst({
      where: and(
        eq(meetingSessions.id, data.meetingId),
        eq(meetingSessions.status, "active"),
      ),
    });

    if (!meeting) throw Errors.NOT_FOUND("Meeting");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    const participant = await getGrantableMeetingParticipant(
      db,
      meeting.id,
      data.targetIdentity,
    );

    const participantIdentity =
      participant.livekitIdentity ?? participant.userId ?? data.targetIdentity;

    await updateScreenSharePermission(env, meeting.id, participantIdentity, data.allow);

    return { success: true };
  });
