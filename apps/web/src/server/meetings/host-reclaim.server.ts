import "@tanstack/react-start/server-only";
import type { Database } from "@ossmeet/db";
import { meetingLivekitPresences, meetingSessions } from "@ossmeet/db/schema";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { logError } from "@/lib/logger";
import { withD1Retry } from "@/lib/db-utils";

export async function reclaimRoomHostIfReturning(
  db: Database,
  env: Env,
  meetingId: string,
  roomHostId: string,
  currentHostId: string,
  returningUserId: string | null | undefined,
): Promise<string> {
  if (!returningUserId || returningUserId !== roomHostId) {
    return currentHostId;
  }

  if (currentHostId !== roomHostId) {
    await withD1Retry(() =>
      db
        .update(meetingSessions)
        .set({ hostId: roomHostId, updatedAt: new Date() })
        .where(and(eq(meetingSessions.id, meetingId), eq(meetingSessions.hostId, currentHostId))),
    );
  }

  const actingHostConnections = await db.query.meetingLivekitPresences.findMany({
    where: and(
      eq(meetingLivekitPresences.sessionId, meetingId),
      eq(meetingLivekitPresences.role, "host"),
      or(isNull(meetingLivekitPresences.userId), ne(meetingLivekitPresences.userId, roomHostId)),
      inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued"]),
    ),
    columns: { id: true, livekitIdentity: true },
  });

  if (actingHostConnections.length === 0) return roomHostId;

  await withD1Retry(() =>
    db
      .update(meetingLivekitPresences)
      .set({ role: "participant", updatedAt: new Date() })
      .where(
        and(
          eq(meetingLivekitPresences.sessionId, meetingId),
          eq(meetingLivekitPresences.role, "host"),
          or(isNull(meetingLivekitPresences.userId), ne(meetingLivekitPresences.userId, roomHostId)),
        ),
      ),
  );

  const roomService = new RoomServiceClient(
    livekitHttpUrl(env.LIVEKIT_URL),
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET,
  );
  const roomName = `meet-${meetingId}`;
  await Promise.allSettled(
    actingHostConnections.map((connection) =>
      roomService.updateParticipant(roomName, connection.livekitIdentity, {
        metadata: JSON.stringify({ sessionId: meetingId, meetingId, role: "participant" }),
        permission: {
          canPublish: true,
          canPublishData: true,
          canSubscribe: true,
          canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
          canUpdateMetadata: false,
        },
      }).catch((err) => {
        logError("[meetingSessions] Failed to demote acting host after original host returned:", err);
      }),
    ),
  );

  return roomHostId;
}
