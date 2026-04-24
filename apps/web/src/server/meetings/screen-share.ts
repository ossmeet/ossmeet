import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";
import { meetingSessions, meetingParticipants } from "@ossmeet/db/schema";
import { eq, and, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { CURRENT_MEETING_PARTICIPANT_STATUSES, Errors } from "@ossmeet/shared";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";

const AUTH_HELPERS_MODULE = "../auth/helpers";

const grantScreenShareSchema = z.object({
  meetingId: z.string(),
  targetIdentity: z.string(),
  allow: z.boolean(),
});

export async function getGrantableMeetingParticipant(
  db: ReturnType<typeof createDb>,
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
  .inputValidator(grantScreenShareSchema)
  .handler(async ({ data }) => {
    const { getEnv, requireAuth, enforceRateLimit } = await import(
      /* @vite-ignore */ AUTH_HELPERS_MODULE
    );
    const env = await getEnv();
    const user = await requireAuth();
    const db = createDb(env.DB);

    await enforceRateLimit(env, `screen-share:grant:${user.id}`);

    const meeting = await db.query.meetingSessions.findFirst({
      where: and(
        eq(meetingSessions.id, data.meetingId),
        eq(meetingSessions.status, "active")
      ),
    });

    if (!meeting) throw Errors.NOT_FOUND("Meeting");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    const participant = await getGrantableMeetingParticipant(
      db,
      meeting.id,
      data.targetIdentity,
    );

    const httpUrl = livekitHttpUrl(env.LIVEKIT_URL);
    const roomService = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    const roomName = `meet-${meeting.id}`;

    const sources = data.allow
      ? [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
      : [TrackSource.CAMERA, TrackSource.MICROPHONE];

    const participantIdentity =
      participant.livekitIdentity ?? participant.userId ?? data.targetIdentity;

    await roomService.updateParticipant(roomName, participantIdentity, {
      permission: {
        canPublish: true,
        canPublishData: true,
        canSubscribe: true,
        canPublishSources: sources,
      },
    });

    return { success: true };
  });
