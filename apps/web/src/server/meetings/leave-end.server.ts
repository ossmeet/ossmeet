import "@tanstack/react-start/server-only";
import { type Database } from "@ossmeet/db";
import { meetingSessions, meetingParticipants } from "@ossmeet/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { CURRENT_MEETING_PARTICIPANT_STATUSES } from "@ossmeet/shared";
import { logError } from "@/lib/logger";
import { withD1Retry } from "@/lib/db-utils";
import { finalizeSessionIfEmpty } from "./session-finalizer";
import { withTimeout } from "@/lib/with-timeout";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { EgressClient, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import {
  enforceRateLimit,
  verifyGuestParticipantBySecret,
} from "../auth/helpers";

// livekit EgressStatus protobuf values: 0=STARTING, 1=ACTIVE, 2=ENDING
const ACTIVE_EGRESS_STATUSES = new Set<number>([0, 1, 2]);

export interface LeaveMeetingExecutionOptions {
  env: Env;
  db: Database;
  meetingId: string;
  participantId?: string;
  authenticatedUserId: string | null;
  guestCookieSecret?: string | null;
  rateLimitKey: string;
  onGuestLeft?: (participantId: string) => void;
  removeFromLiveKit?: boolean;
  promoteSuccessor?: boolean;
  finalizeIfEmpty?: boolean;
}

function isLiveKitRoomMissingError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    const message = String(err).toLowerCase();
    return message.includes("not found") || message.includes("does not exist");
  }
  const errorLike = err as { status?: unknown; code?: unknown; message?: unknown };
  if (errorLike.status === 404) return true;
  if (typeof errorLike.code === "string" && errorLike.code.toLowerCase() === "not_found") return true;
  const message = typeof errorLike.message === "string" ? errorLike.message.toLowerCase() : "";
  return message.includes("not found") || message.includes("does not exist");
}

/**
 * Fully terminate a meeting's LiveKit room and egress.
 * Called by endMeeting, createMeeting (concurrent cap), joinMeeting (duration limit),
 * and deleteSpace cleanup.
 */
export async function terminateMeetingRoom(env: {
  LIVEKIT_URL: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  WHITEBOARD_URL?: string;
  WHITEBOARD_INTERNAL_SECRET?: string;
}, meetingId: string, activeEgressId?: string | null): Promise<void> {
  const httpUrl = livekitHttpUrl(env.LIVEKIT_URL);
  const roomService = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  const egressClient = new EgressClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

  try {
    // Stop ALL active egresses, not just the tracked one, to handle orphans
    try {
      const roomEgresses = await withTimeout(egressClient.listEgress({ roomName: `meet-${meetingId}` }), 10_000);
      for (const egress of roomEgresses) {
        if (egress.status !== undefined && ACTIVE_EGRESS_STATUSES.has(egress.status)) {
          await egressClient.stopEgress(egress.egressId).catch((err) => {
            logError(`[terminateMeetingRoom] Failed to stop egress ${egress.egressId} for meeting ${meetingId}:`, err);
          });
        }
      }
    } catch {
      if (activeEgressId) {
        await egressClient.stopEgress(activeEgressId).catch((err) => {
          logError(`[terminateMeetingRoom] Failed to stop tracked egress ${activeEgressId} for meeting ${meetingId}:`, err);
        });
      }
    }
    await withTimeout(roomService.deleteRoom(`meet-${meetingId}`), 10_000);
  } catch (err: unknown) {
    if (!isLiveKitRoomMissingError(err)) {
      logError(`[terminateMeetingRoom] Failed to delete room for meeting ${meetingId}:`, err);
    }
  }

  if (env.WHITEBOARD_URL && env.WHITEBOARD_INTERNAL_SECRET) {
    try {
      const response = await fetch(`${env.WHITEBOARD_URL}/session-end`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Whiteboard-Secret": env.WHITEBOARD_INTERNAL_SECRET,
        },
        body: JSON.stringify({ sessionId: `meet-${meetingId}` }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        logError(`[terminateMeetingRoom] Whiteboard session-end failed for meeting ${meetingId} with status ${response.status}`);
      }
    } catch {
      // Non-fatal if whiteboard server is unreachable
    }
  }
}

async function promoteSuccessorInRealtimeServices(
  env: Env,
  meetingId: string,
  participantIdentity: string,
): Promise<void> {
  const roomName = `meet-${meetingId}`;
  const httpUrl = livekitHttpUrl(env.LIVEKIT_URL);
  const roomService = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

  await roomService.updateParticipant(roomName, participantIdentity, {
    metadata: JSON.stringify({ meetingId, role: "host" }),
    permission: {
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      canPublishSources: [
        TrackSource.CAMERA,
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ],
      canUpdateMetadata: false,
    },
  }).catch((err) => {
    logError("[meetingSessions] LiveKit host promotion failed:", err);
  });

  if (env.WHITEBOARD_URL && env.WHITEBOARD_INTERNAL_SECRET) {
    const baseUrl = env.WHITEBOARD_URL.trim().replace(/\/+$/, "");
    await fetch(`${baseUrl}/host/promote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Whiteboard-Secret": env.WHITEBOARD_INTERNAL_SECRET,
      },
      body: JSON.stringify({ sessionId: roomName, userId: participantIdentity }),
      signal: AbortSignal.timeout(6_000),
    }).catch((err) => {
      logError("[meetingSessions] Whiteboard host promotion failed:", err);
    });
  }
}

async function maybePromoteSuccessorHost(
  db: Database,
  meetingId: string,
  env: Env,
): Promise<{ autoPromotedWaiters: boolean }> {
  const meeting = await db.query.meetingSessions.findFirst({
    where: and(eq(meetingSessions.id, meetingId), eq(meetingSessions.status, "active")),
    columns: { id: true, hostId: true },
  });
  if (!meeting) return { autoPromotedWaiters: false };

  const hostStillActive = await db.query.meetingParticipants.findFirst({
    where: and(
      eq(meetingParticipants.sessionId, meeting.id),
      eq(meetingParticipants.userId, meeting.hostId),
      inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
    ),
    columns: { id: true },
  });
  if (hostStillActive) return { autoPromotedWaiters: false };

  const successor = await db.query.meetingParticipants.findFirst({
    where: and(
      eq(meetingParticipants.sessionId, meeting.id),
      inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
      eq(meetingParticipants.role, "participant"),
    ),
    orderBy: [asc(meetingParticipants.joinedAt), asc(meetingParticipants.id)],
  });

  if (successor && successor.userId) {
    await withD1Retry(() =>
      db.batch([
        db
          .update(meetingSessions)
          .set({ hostId: successor.userId!, updatedAt: new Date() })
          .where(eq(meetingSessions.id, meeting.id)),
        db
          .update(meetingParticipants)
          .set({ role: "host" })
          .where(eq(meetingParticipants.id, successor.id)),
      ]),
    );
    const participantIdentity = successor.livekitIdentity ?? successor.userId;
    await promoteSuccessorInRealtimeServices(env, meeting.id, participantIdentity);
    return { autoPromotedWaiters: false };
  }

  await withD1Retry(() =>
    db
      .update(meetingParticipants)
      .set({ status: "pending" })
      .where(
        and(
          eq(meetingParticipants.sessionId, meeting.id),
          eq(meetingParticipants.status, "awaiting_approval"),
        ),
      ),
  );
  return { autoPromotedWaiters: true };
}

export async function executeLeaveMeeting({
  env,
  db,
  meetingId,
  participantId,
  authenticatedUserId,
  guestCookieSecret,
  rateLimitKey,
  onGuestLeft,
  removeFromLiveKit = true,
  promoteSuccessor = true,
  finalizeIfEmpty = true,
}: LeaveMeetingExecutionOptions): Promise<{ success: true; found: boolean }> {
  await enforceRateLimit(env, rateLimitKey);

  let found = false;

  if (authenticatedUserId && participantId) {
    const activeParticipant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.id, participantId),
        eq(meetingParticipants.sessionId, meetingId),
        eq(meetingParticipants.userId, authenticatedUserId),
        inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
      ),
    });

    if (activeParticipant) {
      await withD1Retry(() =>
        db
          .update(meetingParticipants)
          .set({ status: "left", leftAt: new Date() })
          .where(eq(meetingParticipants.id, activeParticipant.id))
      );
      const identity = activeParticipant.livekitIdentity ?? authenticatedUserId;
      if (removeFromLiveKit) {
        const roomName = `meet-${meetingId}`;
        const roomService = new RoomServiceClient(
          livekitHttpUrl(env.LIVEKIT_URL),
          env.LIVEKIT_API_KEY,
          env.LIVEKIT_API_SECRET,
        );
        roomService.removeParticipant(roomName, identity).catch((err: unknown) => {
          logError("[meetingSessions] LiveKit cleanup failed:", err);
        });
      }
      found = true;
    }
  } else if (participantId) {
    const row = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.id, participantId),
        eq(meetingParticipants.sessionId, meetingId),
        inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
      ),
      columns: { id: true, userId: true },
    });
    if (!row) return { success: true, found: false };
    if (row.userId !== null) return { success: true, found: false };

    const guestParticipant = await verifyGuestParticipantBySecret(
      db,
      meetingId,
      participantId,
      guestCookieSecret ?? null,
    );

    await withD1Retry(() =>
      db
        .update(meetingParticipants)
        .set({ status: "left", leftAt: new Date() })
        .where(eq(meetingParticipants.id, guestParticipant.id))
    );
    const identity = guestParticipant.livekitIdentity ?? `guest_${guestParticipant.id}`;
    if (removeFromLiveKit) {
      const roomService = new RoomServiceClient(
        livekitHttpUrl(env.LIVEKIT_URL),
        env.LIVEKIT_API_KEY,
        env.LIVEKIT_API_SECRET,
      );
      roomService.removeParticipant(`meet-${meetingId}`, identity).catch((err: unknown) => {
        logError("[meetingSessions] LiveKit cleanup failed:", err);
      });
    }
    onGuestLeft?.(guestParticipant.id);
    found = true;
  }

  if (found) {
    let autoPromotedWaiters = false;
    if (promoteSuccessor) {
      ({ autoPromotedWaiters } = await maybePromoteSuccessorHost(db, meetingId, env));
    }

    if (finalizeIfEmpty) {
      const finalized = await finalizeSessionIfEmpty(db, {
        meetingId,
        now: new Date(),
        onlyActive: true,
        ignorePendingParticipants: autoPromotedWaiters,
        env,
      }).catch((err) => {
        logError("[meetingSessions] Failed to auto-finalize empty meeting:", err);
        return null;
      });
      if (finalized) {
        terminateMeetingRoom(env, finalized.meetingId, finalized.activeEgressId).catch((err) => {
          logError("[meetingSessions] LiveKit cleanup failed after auto-finalize:", err);
        });
      }
    }
  }

  return { success: true, found };
}
