import "@tanstack/react-start/server-only";
import { createDb } from "@ossmeet/db";
import { meetingSessions, rooms as appRooms } from "@ossmeet/db/schema";
import { and, eq } from "drizzle-orm";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { logError } from "@/lib/logger";
import { withTimeout } from "@/lib/with-timeout";
import {
  EgressClient,
  RoomServiceClient,
  StreamOutput,
  StreamProtocol,
  EncodingOptionsPreset,
} from "livekit-server-sdk";
import { getRunChanges, withD1Retry } from "@/lib/db-utils";
import type { StreamingPlatform } from "@ossmeet/shared";
import { getWhiteboardRecorderCustomBaseUrl } from "@whiteboard/server";
import {
  isMissingEgressError,
  startRoomCompositeEgressWithRecovery,
  type EgressTaskStartResult,
} from "./egress-startup.server";

function buildRtmpUrl(platform: StreamingPlatform, streamKey: string): string {
  const trimmed = streamKey.trim();
  switch (platform) {
    case "twitch":
      return `rtmp://live.twitch.tv/app/${trimmed}`;
    case "youtube":
      return `rtmps://a.rtmp.youtube.com/live2/${trimmed}`;
    case "facebook":
      return `rtmps://live-api-s.facebook.com:443/rtmp/${trimmed}`;
    case "kick":
      return `rtmps://fa723fc1b171.global-contribute.live-video.net:443/app/${trimmed}`;
    case "linkedin":
    case "instagram":
    case "tiktok":
    case "x":
    case "custom":
      if (!/^rtmps?:\/\/\S+$/i.test(trimmed)) {
        throw new Error("Custom stream URL must start with rtmp:// or rtmps://");
      }
      return trimmed;
  }
}

export async function startStreamingTask(
  env: Env,
  meetingId: string,
  sentinel: string,
  platform: StreamingPlatform,
  streamKey: string,
): Promise<EgressTaskStartResult | null> {
  const db = createDb(env.DB);
  const meeting = await db.query.meetingSessions.findFirst({
    where: and(eq(meetingSessions.id, meetingId), eq(meetingSessions.status, "active")),
    columns: { id: true, roomId: true, activeStreamEgressId: true },
  });
  if (!meeting || meeting.activeStreamEgressId !== sentinel) {
    return null;
  }

  const httpUrl = livekitHttpUrl(env.LIVEKIT_URL);
  const egressClient = new EgressClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  const roomService = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  const roomName = `meet-${meetingId}`;
  const appRoom = await db.query.rooms.findFirst({
    where: eq(appRooms.id, meeting.roomId),
    columns: { code: true },
  });

  const rooms = await withTimeout(roomService.listRooms([roomName]), 10_000);
  if (!rooms || rooms.length === 0) {
    await withD1Retry(() =>
      db.update(meetingSessions)
        .set({ activeStreamEgressId: null, updatedAt: new Date() })
        .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeStreamEgressId, sentinel)))
    );
    return { error: "LiveKit room was not found." };
  }

  const rtmpUrl = buildRtmpUrl(platform, streamKey);
  const output = new StreamOutput({
    protocol: StreamProtocol.RTMP,
    urls: [rtmpUrl],
  });
  const customBaseUrl = getWhiteboardRecorderCustomBaseUrl
    ? await getWhiteboardRecorderCustomBaseUrl(env, meetingId, {
        meetingCode: appRoom?.code ?? null,
      })
    : undefined;

  const started = await startRoomCompositeEgressWithRecovery({
    egressClient,
    roomName,
    logPrefix: "[streaming]",
    requireStreamOutput: true,
    start: () =>
      withTimeout(
        egressClient.startRoomCompositeEgress(roomName, output, {
          layout: "",
          encodingOptions: EncodingOptionsPreset.H264_1080P_30,
          ...(customBaseUrl && { customBaseUrl }),
        }),
        15_000,
      ),
    clearStartingState: () =>
      withD1Retry(() =>
        db
          .update(meetingSessions)
          .set({ activeStreamEgressId: null, updatedAt: new Date() })
          .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeStreamEgressId, sentinel))),
      ).then(() => undefined),
    commitStartedEgress: async (egressId) => {
      const updateResult = await withD1Retry(() =>
        db.update(meetingSessions)
          .set({ activeStreamEgressId: egressId, updatedAt: new Date() })
          .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeStreamEgressId, sentinel)))
          .run()
      );
      return getRunChanges(updateResult) > 0;
    },
  });
  if (!started || "error" in started) return started;

  await withTimeout(
    roomService.updateRoomMetadata(roomName, JSON.stringify({ egressMode: "streaming" })),
    5_000
  ).catch((err) => {
    logError("[streaming] Failed to update room metadata after stream start:", err);
  });

  return started;
}

export async function stopStreamingTask(
  env: Env,
  meetingId: string,
  egressId: string,
): Promise<void> {
  const db = createDb(env.DB);
  const httpUrl = livekitHttpUrl(env.LIVEKIT_URL);
  const egressClient = new EgressClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  const roomService = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

  try {
    await withTimeout(egressClient.stopEgress(egressId), 10_000);
  } catch (err) {
    if (!isMissingEgressError(err)) {
      throw err;
    }
  }

  await withD1Retry(() =>
    db.update(meetingSessions)
      .set({ activeStreamEgressId: null, updatedAt: new Date() })
      .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeStreamEgressId, egressId)))
  );

  await withTimeout(
    roomService.updateRoomMetadata(`meet-${meetingId}`, JSON.stringify({ egressMode: null })),
    5_000
  ).catch((err) => {
    logError("[streaming] Failed to update room metadata after stream stop:", err);
  });
}
