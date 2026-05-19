import "@tanstack/react-start/server-only";
import { type Database } from "@ossmeet/db";
import { meetingAdmissions, meetingLivekitPresences, meetingSessions } from "@ossmeet/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { logError } from "@/lib/logger";
import { withD1Retry, getRunChanges } from "@/lib/db-utils";
import { finalizeSession, runPostMeetingTasks, type SessionEndReason } from "./session-finalizer";
import { withTimeout } from "@/lib/with-timeout";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { EgressClient, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import {
  enforceRateLimit,
  verifyGuestAdmissionBySecret,
} from "../auth/helpers";
import { expireStaleAwaitingParticipants } from "./waiting-room";
import { notifyWhiteboardHostPromoted } from "@whiteboard/server";

// LiveKit EgressStatus protobuf values: 0=STARTING, 1=ACTIVE, 2=ENDING
const ACTIVE_EGRESS_STATUSES = new Set<number>([0, 1, 2]);

type LiveKitEnv = Pick<Env, "LIVEKIT_URL" | "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET">;

export interface HostPromotionRealtimeServices {
  promoteHost(env: Env, meetingId: string, participantIdentity: string): Promise<void>;
}

export interface LeaveMeetingExecutionOptions {
  env: Env;
  db: Database;
  meetingId: string;
  connectionId?: string;
  authenticatedUserId: string | null;
  guestCookieSecret?: string | null;
  rateLimitKey: string;
  onGuestLeft?: (admissionId: string) => void;
  removeFromLiveKit?: boolean;
  promoteSuccessor?: boolean;
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
 * Tear down the LiveKit side of a meeting: stop any active egresses and
 * delete the room (which forcibly disconnects every participant).
 *
 * This is *only* the LiveKit half of ending a session. To also write
 * `status=ended` and run post-meeting side effects (transcripts,
 * whiteboard), use `endSession` — which composes `finalizeSession` +
 * this function in the right order.
 *
 * Safe to call when the room is already gone (treated as success).
 */
export async function tearDownLiveKitRoom(
  env: LiveKitEnv,
  meetingId: string,
  activeEgressId?: string | null,
  activeStreamEgressId?: string | null,
): Promise<void> {
  const httpUrl = livekitHttpUrl(env.LIVEKIT_URL);
  const roomService = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  const egressClient = new EgressClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

  try {
    // Stop ALL active egresses, not just the tracked one, to handle orphans.
    try {
      const roomEgresses = await withTimeout(
        egressClient.listEgress({ roomName: `meet-${meetingId}` }),
        10_000,
      );
      await Promise.allSettled(
        roomEgresses
          .filter((e) => e.status !== undefined && ACTIVE_EGRESS_STATUSES.has(e.status))
          .map((e) =>
            withTimeout(egressClient.stopEgress(e.egressId), 8_000).catch((err) => {
              logError(
                `[tearDownLiveKitRoom] Failed to stop egress ${e.egressId} for meeting ${meetingId}:`,
                err,
              );
            }),
          ),
      );
    } catch {
      await Promise.allSettled(
        [activeEgressId, activeStreamEgressId]
          .filter((id): id is string => Boolean(id && !id.startsWith("__starting__:")))
          .map((egressId) =>
            withTimeout(egressClient.stopEgress(egressId), 8_000).catch((err) => {
              logError(
                `[tearDownLiveKitRoom] Failed to stop tracked egress ${egressId} for meeting ${meetingId}:`,
                err,
              );
            }),
          ),
      );
    }
    await withTimeout(roomService.deleteRoom(`meet-${meetingId}`), 10_000);
  } catch (err: unknown) {
    if (!isLiveKitRoomMissingError(err)) {
      logError(`[tearDownLiveKitRoom] Failed to delete room for meeting ${meetingId}:`, err);
    }
  }
}

/**
 * The single canonical "end this meeting now" entry point.
 *
 * Order:
 *   1. `finalizeSession` — idempotent CAS to `ended` (DB only, no post-meeting tasks).
 *   2. `tearDownLiveKitRoom` — kicks everyone off LiveKit.
 *   3. `runPostMeetingTasks` — AI summary, whiteboard notification, audit event.
 *      If `ctx` is provided (Cloudflare Worker request context) the tasks run
 *      via ctx.waitUntil() so they don't block the client waiting for the
 *      meeting-end response. Otherwise they are awaited inline (background jobs).
 *
 * If `finalizeSession` returns null the session was already ended (or
 * doesn't exist); teardown and post-meeting tasks are skipped since another
 * caller has already taken responsibility for them.
 */
export async function endSession(
  db: Database,
  env: Env,
  meetingId: string,
  reason: SessionEndReason,
  ctx?: ExecutionContext,
): Promise<void> {
  // DB-only finalization: no env means runPostMeetingTasks is skipped here.
  const finalized = await finalizeSession(db, { meetingId, reason });
  if (!finalized) return;
  await tearDownLiveKitRoom(env, meetingId, finalized.activeEgressId, finalized.activeStreamEgressId);
  const postMeetingWork = runPostMeetingTasks(db, env, meetingId, reason);
  if (ctx) {
    ctx.waitUntil(postMeetingWork);
  } else {
    await postMeetingWork;
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
    metadata: JSON.stringify({ sessionId: meetingId, meetingId, role: "moderator", actingModerator: true }),
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
  });

  await notifyWhiteboardHostPromoted?.(env, meetingId, participantIdentity);
}

const defaultHostPromotionRealtimeServices: HostPromotionRealtimeServices = {
  promoteHost: promoteSuccessorInRealtimeServices,
};

export async function maybePromoteSuccessorHost(
  db: Database,
  meetingId: string,
  env: Env,
  realtimeServices: HostPromotionRealtimeServices = defaultHostPromotionRealtimeServices,
): Promise<{ promoted: boolean; successorIdentity?: string }> {
  const meeting = await db.query.meetingSessions.findFirst({
    where: and(eq(meetingSessions.id, meetingId), eq(meetingSessions.status, "active")),
    columns: { id: true, hostId: true },
  });
  if (!meeting) return { promoted: false };

  await expireStaleAwaitingParticipants(db, meeting.id);

  const hostStillActive = await db.query.meetingLivekitPresences.findFirst({
    where: and(
      eq(meetingLivekitPresences.sessionId, meeting.id),
      eq(meetingLivekitPresences.userId, meeting.hostId),
      eq(meetingLivekitPresences.presenceStatus, "connected"),
    ),
    columns: { id: true },
  });
  if (hostStillActive) return { promoted: false };

  const [successor] = await db
    .select({
      connectionId: meetingLivekitPresences.id,
      admissionId: meetingLivekitPresences.admissionId,
      livekitIdentity: meetingLivekitPresences.livekitIdentity,
      userId: meetingLivekitPresences.userId,
      role: meetingLivekitPresences.role,
      connectedAt: meetingLivekitPresences.connectedAt,
      tokenIssuedAt: meetingLivekitPresences.tokenIssuedAt,
    })
    .from(meetingLivekitPresences)
    .where(
        and(
          eq(meetingLivekitPresences.sessionId, meeting.id),
          eq(meetingLivekitPresences.presenceStatus, "connected"),
          inArray(meetingLivekitPresences.role, ["participant", "guest"]),
        ),
    )
    .orderBy(asc(meetingLivekitPresences.connectedAt), asc(meetingLivekitPresences.tokenIssuedAt), asc(meetingLivekitPresences.id))
    .limit(1);

  if (successor) {
    await withD1Retry(() =>
      db
        .update(meetingLivekitPresences)
        .set({ role: "host", updatedAt: new Date() })
        .where(eq(meetingLivekitPresences.id, successor.connectionId)),
    );
    try {
      await realtimeServices.promoteHost(env, meeting.id, successor.livekitIdentity);
    } catch (err) {
      logError("[meetingSessions] Realtime host promotion failed; rolling back acting host role:", err);
      await withD1Retry(() =>
        db
          .update(meetingLivekitPresences)
          .set({ role: successor.role, updatedAt: new Date() })
          .where(eq(meetingLivekitPresences.id, successor.connectionId)),
      ).catch((rollbackErr) => {
        logError("[meetingSessions] Failed to roll back acting host presence role:", rollbackErr);
      });
      throw err;
    }
    return { promoted: true, successorIdentity: successor.livekitIdentity };
  }

  await withD1Retry(() =>
    db
      .update(meetingAdmissions)
      .set({ admissionStatus: "approved", grantedRole: "participant", decidedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(meetingAdmissions.sessionId, meeting.id),
          eq(meetingAdmissions.admissionStatus, "awaiting_approval"),
        ),
      ),
  );
  return { promoted: false };
}

/**
 * Mark a single participant as left.
 *
 * Intentionally does NOT decide whether the meeting itself is over.
 * That's LiveKit's job: when the last participant disconnects, the
 * `departure_timeout` (configured in `livekit.yaml`) gives them a
 * grace period to rejoin (e.g. tab close + reopen the link). Only if
 * no one returns within that window does LiveKit emit `room_finished`,
 * which is the authoritative signal handled in
 * `routes/api/livekit/-webhook.server.ts` and finalizes the session.
 */
export async function executeLeaveMeeting({
  env,
  db,
  meetingId,
  connectionId,
  authenticatedUserId,
  guestCookieSecret,
  rateLimitKey,
  onGuestLeft,
  removeFromLiveKit = true,
  promoteSuccessor = true,
}: LeaveMeetingExecutionOptions): Promise<{ success: true; found: boolean }> {
  await enforceRateLimit(env, rateLimitKey);

  let found = false;

  const connection = connectionId
    ? await db.query.meetingLivekitPresences.findFirst({
        where: and(
          eq(meetingLivekitPresences.id, connectionId),
          eq(meetingLivekitPresences.sessionId, meetingId),
          inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued"]),
        ),
      })
    : null;

  if (authenticatedUserId && connection) {
    if (connection.userId !== authenticatedUserId) return { success: true, found: false };
    const result = await withD1Retry(() =>
      db
        .update(meetingLivekitPresences)
        .set({ presenceStatus: "disconnected", disconnectReason: "leave_endpoint", disconnectedAt: new Date(), updatedAt: new Date() })
        .where(eq(meetingLivekitPresences.id, connection.id))
        .run(),
    );
    if (getRunChanges(result) > 0) {
      const identity = connection.livekitIdentity;
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
  } else if (connection) {
    if (connection.userId !== null) return { success: true, found: false };
    const guestAdmission = await verifyGuestAdmissionBySecret(
      db,
      meetingId,
      connection.admissionId,
      guestCookieSecret ?? null,
    );

    const result = await withD1Retry(() =>
      db
        .update(meetingLivekitPresences)
        .set({ presenceStatus: "disconnected", disconnectReason: "leave_endpoint", disconnectedAt: new Date(), updatedAt: new Date() })
        .where(eq(meetingLivekitPresences.id, connection.id))
        .run(),
    );
    if (getRunChanges(result) > 0) {
      const identity = connection.livekitIdentity;
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
    }
    onGuestLeft?.(guestAdmission.id);
    found = true;
  }

  if (found && promoteSuccessor) {
    await maybePromoteSuccessorHost(db, meetingId, env);
  }

  return { success: true, found };
}
