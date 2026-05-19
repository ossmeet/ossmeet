import type { Database } from "@ossmeet/db";
import { meetingAdmissions, meetingLivekitPresences, meetingSessions } from "@ossmeet/db/schema";
import { and, eq, inArray, lt } from "drizzle-orm";
import { RoomServiceClient } from "livekit-server-sdk";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { logError } from "@/lib/logger";
import { withTimeout } from "@/lib/with-timeout";
import { finalizeSession, finalizeSessions } from "./session-finalizer";

const ROOM_MISSING_ACTIVE_GRACE_MS = 2 * 60 * 1000;
const ROOM_MISSING_PENDING_ONLY_GRACE_MS = 10 * 60 * 1000;
const ROOM_MISSING_EMPTY_SESSION_GRACE_MS = 60 * 60 * 1000;
const STALE_SESSION_BATCH_LIMIT = 50;
const OCCUPYING_CONNECTION_STATUSES = ["token_issued", "connected"] as const;

type OccupyingParticipantStatus = "awaiting_approval" | "pending" | "active";

export type MissingRoomOccupantSnapshot = {
  status: OccupyingParticipantStatus;
  joinedAt: Date;
};

export interface MissingRoomSessionSnapshot {
  id: string;
  startedAt: Date;
}

export function getMissingRoomFinalizeReason(
  session: MissingRoomSessionSnapshot,
  occupants: MissingRoomOccupantSnapshot[],
  now = new Date(),
): string | null {
  const sessionAgeMs = now.getTime() - session.startedAt.getTime();
  if (sessionAgeMs < ROOM_MISSING_ACTIVE_GRACE_MS) {
    return null;
  }

  if (occupants.length === 0) {
    return sessionAgeMs >= ROOM_MISSING_EMPTY_SESSION_GRACE_MS
      ? "missing_livekit_room_empty_session"
      : null;
  }

  const newestJoinedAt = occupants.reduce(
    (latest, occupant) => occupant.joinedAt.getTime() > latest ? occupant.joinedAt.getTime() : latest,
    0,
  );
  const newestOccupantAgeMs = now.getTime() - newestJoinedAt;
  const hasActiveOccupant = occupants.some((occupant) => occupant.status === "active");

  if (hasActiveOccupant) {
    return newestOccupantAgeMs >= ROOM_MISSING_ACTIVE_GRACE_MS
      ? "missing_livekit_room_active_participants"
      : null;
  }

  return newestOccupantAgeMs >= ROOM_MISSING_PENDING_ONLY_GRACE_MS
    ? "missing_livekit_room_stale_pending_participants"
    : null;
}

async function listExistingRoomNames(
  env: Pick<Env, "LIVEKIT_URL" | "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET">,
  roomNames: string[],
): Promise<Set<string>> {
  if (roomNames.length === 0) return new Set();

  const roomService = new RoomServiceClient(
    livekitHttpUrl(env.LIVEKIT_URL),
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET,
  );
  const rooms = await withTimeout(roomService.listRooms(roomNames), 10_000);
  return new Set(rooms.map((room) => room.name));
}

async function listMissingRoomOccupants(
  db: Database,
  meetingIds: string[],
): Promise<Map<string, MissingRoomOccupantSnapshot[]>> {
  const occupantsByMeetingId = new Map<string, MissingRoomOccupantSnapshot[]>();
  if (meetingIds.length === 0) return occupantsByMeetingId;

  const addOccupant = (sessionId: string, occupant: MissingRoomOccupantSnapshot) => {
    const current = occupantsByMeetingId.get(sessionId);
    if (current) {
      current.push(occupant);
    } else {
      occupantsByMeetingId.set(sessionId, [occupant]);
    }
  };

  const connectionRows = await db
    .select({
      sessionId: meetingLivekitPresences.sessionId,
      presenceStatus: meetingLivekitPresences.presenceStatus,
      tokenIssuedAt: meetingLivekitPresences.tokenIssuedAt,
      connectedAt: meetingLivekitPresences.connectedAt,
    })
    .from(meetingLivekitPresences)
    .where(
      and(
        inArray(meetingLivekitPresences.sessionId, meetingIds),
        inArray(meetingLivekitPresences.presenceStatus, OCCUPYING_CONNECTION_STATUSES),
      ),
    );

  for (const row of connectionRows) {
    addOccupant(row.sessionId, {
      status: row.presenceStatus === "connected" ? "active" : "pending",
      joinedAt: row.connectedAt ?? row.tokenIssuedAt,
    });
  }

  const awaitingRows = await db
    .select({
      sessionId: meetingAdmissions.sessionId,
      createdAt: meetingAdmissions.createdAt,
    })
    .from(meetingAdmissions)
    .where(
      and(
        inArray(meetingAdmissions.sessionId, meetingIds),
        eq(meetingAdmissions.admissionStatus, "awaiting_approval"),
      ),
    );

  for (const row of awaitingRows) {
    addOccupant(row.sessionId, {
      status: "awaiting_approval",
      joinedAt: row.createdAt,
    });
  }

  return occupantsByMeetingId;
}

export async function maybeFinalizeStaleMeetingSession(
  db: Database,
  env: Env,
  session: MissingRoomSessionSnapshot,
  now = new Date(),
): Promise<boolean> {
  const reason = await (async () => {
    if (now.getTime() - session.startedAt.getTime() < ROOM_MISSING_ACTIVE_GRACE_MS) {
      return null;
    }

    const existingRooms = await listExistingRoomNames(env, [`meet-${session.id}`]);
    if (existingRooms.has(`meet-${session.id}`)) {
      return null;
    }

    const occupantsByMeetingId = await listMissingRoomOccupants(db, [session.id]);

    return getMissingRoomFinalizeReason(
      session,
      occupantsByMeetingId.get(session.id) ?? [],
      now,
    );
  })().catch((err) => {
    logError("[staleSessions] Failed to inspect LiveKit room state:", err);
    return null;
  });

  if (!reason) return false;

  await finalizeSession(db, {
    meetingId: session.id,
    reason: "stale",
    now,
    onlyActive: true,
    env,
  });
  return true;
}

export async function cleanupStaleSessionsWithoutLiveKitRoom(
  db: Database,
  env: Env,
  now = new Date(),
): Promise<string[]> {
  const candidates = await db
    .select({
      id: meetingSessions.id,
      startedAt: meetingSessions.startedAt,
    })
    .from(meetingSessions)
    .where(
      and(
        eq(meetingSessions.status, "active"),
        lt(meetingSessions.startedAt, new Date(now.getTime() - ROOM_MISSING_ACTIVE_GRACE_MS)),
      ),
    )
    .limit(STALE_SESSION_BATCH_LIMIT);

  if (candidates.length === 0) return [];

  const roomNames = candidates.map((candidate) => `meet-${candidate.id}`);
  let existingRooms: Set<string>;
  try {
    existingRooms = await listExistingRoomNames(env, roomNames);
  } catch (err) {
    logError("[staleSessions] Failed to list LiveKit rooms during cleanup:", err);
    return [];
  }

  const missingCandidates = candidates.filter((candidate) => !existingRooms.has(`meet-${candidate.id}`));
  if (missingCandidates.length === 0) return [];

  const meetingIds = missingCandidates.map((candidate) => candidate.id);
  const occupantsByMeetingId = await listMissingRoomOccupants(db, meetingIds);

  const staleIds = missingCandidates
    .filter((candidate) =>
      Boolean(
        getMissingRoomFinalizeReason(candidate, occupantsByMeetingId.get(candidate.id) ?? [], now),
      ),
    )
    .map((candidate) => candidate.id);

  if (staleIds.length === 0) return [];

  await finalizeSessions(db, {
    meetingIds: staleIds,
    reason: "stale",
    now,
    onlyActive: true,
    env,
  });
  return staleIds;
}
