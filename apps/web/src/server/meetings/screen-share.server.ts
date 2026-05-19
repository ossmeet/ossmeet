import "@tanstack/react-start/server-only";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";

export async function updateScreenSharePermission(
  env: Pick<Env, "LIVEKIT_URL" | "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET">,
  meetingId: string,
  participantIdentity: string,
  allow: boolean,
): Promise<void> {
  const roomService = new RoomServiceClient(
    livekitHttpUrl(env.LIVEKIT_URL),
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET,
  );
  const sources = allow
    ? [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
    : [TrackSource.CAMERA, TrackSource.MICROPHONE];

  await roomService.updateParticipant(`meet-${meetingId}`, participantIdentity, {
    permission: {
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      canPublishSources: sources,
    },
  });
}
