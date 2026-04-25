import "@tanstack/react-start/server-only";
import { createDb } from "@ossmeet/db";
import { meetingSessions } from "@ossmeet/db/schema";
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
import { createWhiteboardJWT } from "@/lib/jwt-utils";
import { getRunChanges, withD1Retry } from "@/lib/db-utils";

export async function startRecordingTask(
  env: Env,
  meetingId: string,
  sentinel: string,
): Promise<{ egressId: string } | null> {
  const db = createDb(env.DB);
  const meeting = await db.query.meetingSessions.findFirst({
    where: and(eq(meetingSessions.id, meetingId), eq(meetingSessions.status, "active")),
    columns: { id: true, activeEgressId: true },
  });
  if (!meeting || meeting.activeEgressId !== sentinel) {
    return null;
  }

  const httpUrl = livekitHttpUrl(env.LIVEKIT_URL);
  const egressClient = new EgressClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  const roomService = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  const roomName = `meet-${meetingId}`;

  const rooms = await withTimeout(roomService.listRooms([roomName]), 10_000);
  if (!rooms || rooms.length === 0) {
    await withD1Retry(() =>
      db.update(meetingSessions)
        .set({ activeEgressId: null, updatedAt: new Date() })
        .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeEgressId, sentinel)))
    );
    return null;
  }

  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME || !env.R2_ACCOUNT_ID) {
    await withD1Retry(() =>
      db.update(meetingSessions)
        .set({ activeEgressId: null, updatedAt: new Date() })
        .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeEgressId, sentinel)))
    );
    return null;
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

  let customBaseUrl: string | undefined;
  if (env.WHITEBOARD_URL && env.WHITEBOARD_JWT_SECRET) {
    const wbToken = await createWhiteboardJWT(
      env.WHITEBOARD_JWT_SECRET,
      { sub: "recorder", name: "Recorder", role: "guest", sid: `meet-${meetingId}` },
      24 * 3600
    );
    const search = new URLSearchParams({ wb_url: env.WHITEBOARD_URL, wb_token: wbToken });
    customBaseUrl = `${env.APP_URL}/recorder?${search.toString()}`;
  }

  // If the LiveKit call throws (timeout or API error), clear the sentinel so
  // the user can retry. Without this, the meeting shows "recording starting"
  // permanently and the host has no recovery path until the meeting ends.
  let info;
  try {
    info = await withTimeout(
      egressClient.startRoomCompositeEgress(roomName, output, {
        layout: "",
        encodingOptions: EncodingOptionsPreset.H264_720P_30,
        ...(customBaseUrl && { customBaseUrl }),
      }),
      15_000,
    );
  } catch (err) {
    logError("[recording] Egress start failed, clearing sentinel:", err);
    // withTimeout cancels our wait but not the LiveKit request itself — the egress
    // may have started on the server. Best-effort: list and stop any active egress
    // for this room so we don't leave a runaway recording.
    try {
      const runningEgresses = await withTimeout(egressClient.listEgress({ roomName }), 10_000);
      const ACTIVE_STATUSES = new Set([0, 1, 2]); // STARTING, ACTIVE, ENDING
      for (const egress of runningEgresses) {
        if (egress.status !== undefined && ACTIVE_STATUSES.has(egress.status)) {
          await egressClient.stopEgress(egress.egressId).catch((stopErr) => {
            logError("[recording] Failed to stop post-timeout egress:", stopErr);
          });
        }
      }
    } catch {
      // Ignore — sentinel clearing below is the primary recovery path
    }
    await withD1Retry(() =>
      db
        .update(meetingSessions)
        .set({ activeEgressId: null, updatedAt: new Date() })
        .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeEgressId, sentinel))),
    ).catch((clearErr) => {
      logError("[recording] Failed to clear sentinel after egress failure:", clearErr);
    });
    return null;
  }

  const updateResult = await withD1Retry(() =>
    db.update(meetingSessions)
      .set({ activeEgressId: info.egressId, updatedAt: new Date() })
      .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.activeEgressId, sentinel)))
      .run()
  );
  const changes = getRunChanges(updateResult);
  if (changes === 0) {
    await egressClient.stopEgress(info.egressId).catch((stopErr) => {
      logError("[recording] Failed to stop orphaned egress after lost sentinel ownership:", stopErr);
    });
    return null;
  }

  await withTimeout(
    roomService.updateRoomMetadata(roomName, JSON.stringify({ recordingActive: true })),
    5_000
  ).catch((err) => {
    logError("[recording] Failed to update room metadata after recording start:", err);
  });

  return { egressId: info.egressId };
}

function isMissingEgressError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("not found") || message.includes("does not exist");
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
    roomService.updateRoomMetadata(`meet-${meetingId}`, JSON.stringify({ recordingActive: false })),
    5_000
  ).catch((err) => {
    logError("[recording] Failed to update room metadata after recording stop:", err);
  });
}
