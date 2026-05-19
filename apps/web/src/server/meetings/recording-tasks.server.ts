import "@tanstack/react-start/server-only";
import { createDb } from "@ossmeet/db";
import { meetingSessions, rooms as appRooms } from "@ossmeet/db/schema";
import { and, eq } from "drizzle-orm";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { logError } from "@/lib/logger";
import { withTimeout } from "@/lib/with-timeout";
import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptionsPreset,
  RoomServiceClient,
} from "livekit-server-sdk";
import { getRunChanges, withD1Retry } from "@/lib/db-utils";
import { getWhiteboardRecorderCustomBaseUrl } from "@whiteboard/server";
import {
  isMissingEgressError,
  startRoomCompositeEgressWithRecovery,
  type EgressTaskStartResult,
} from "./egress-startup.server";

export async function startRecordingTask(
  env: Env,
  meetingId: string,
  sentinel: string,
): Promise<EgressTaskStartResult | null> {
  const db = createDb(env.DB);
  const meeting = await db.query.meetingSessions.findFirst({
    where: and(eq(meetingSessions.id, meetingId), eq(meetingSessions.status, "active")),
    columns: { id: true, roomId: true, activeEgressId: true },
  });
  if (!meeting || meeting.activeEgressId !== sentinel) {
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
        .set({ activeEgressId: null, updatedAt: new Date() })
        .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeEgressId, sentinel)))
    );
    return { error: "LiveKit room was not found." };
  }

  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME || !env.R2_ACCOUNT_ID) {
    await withD1Retry(() =>
      db.update(meetingSessions)
        .set({ activeEgressId: null, updatedAt: new Date() })
        .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeEgressId, sentinel)))
    );
    return { error: "Recording storage is not configured." };
  }

  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: `recordings/${meetingId}/{room_name}-{time}.mp4`,
    output: {
      case: "s3",
      value: {
        accessKey: env.R2_ACCESS_KEY_ID,
        secret: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET_NAME,
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        region: "auto",
        forcePathStyle: true,
      },
    },
  });

  const customBaseUrl = getWhiteboardRecorderCustomBaseUrl
    ? await getWhiteboardRecorderCustomBaseUrl(env, meetingId, {
        meetingCode: appRoom?.code ?? null,
      })
    : undefined;

  const started = await startRoomCompositeEgressWithRecovery({
    egressClient,
    roomName,
    logPrefix: "[recording]",
    requireStreamOutput: false,
    start: () =>
      withTimeout(
        egressClient.startRoomCompositeEgress(roomName, output, {
          layout: "",
          encodingOptions: EncodingOptionsPreset.H264_720P_30,
          ...(customBaseUrl && { customBaseUrl }),
        }),
        15_000,
      ),
    clearStartingState: () =>
      withD1Retry(() =>
        db
          .update(meetingSessions)
          .set({ activeEgressId: null, updatedAt: new Date() })
          .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeEgressId, sentinel))),
      ).then(() => undefined),
    commitStartedEgress: async (egressId) => {
      const updateResult = await withD1Retry(() =>
        db.update(meetingSessions)
          .set({ activeEgressId: egressId, updatedAt: new Date() })
          .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeEgressId, sentinel)))
          .run()
      );
      return getRunChanges(updateResult) > 0;
    },
  });
  if (!started || "error" in started) return started;

  await withTimeout(
    roomService.updateRoomMetadata(roomName, JSON.stringify({ egressMode: "recording" })),
    5_000
  ).catch((err) => {
    logError("[recording] Failed to update room metadata after recording start:", err);
  });

  return started;
}

export async function stopRecordingTask(
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
      .set({ activeEgressId: null, updatedAt: new Date() })
      .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeEgressId, egressId)))
  );

  await withTimeout(
    roomService.updateRoomMetadata(`meet-${meetingId}`, JSON.stringify({ egressMode: null })),
    5_000
  ).catch((err) => {
    logError("[recording] Failed to update room metadata after recording stop:", err);
  });
}
