import type { Database } from "@ossmeet/db";
import { meetingLivekitPresences } from "@ossmeet/db/schema";
import { and, count, eq, gte, inArray, or } from "drizzle-orm";

const TOKEN_ISSUED_CAPACITY_GRACE_MS = 60 * 1000;
const TOKEN_ISSUED_WHITEBOARD_GRACE_MS = 2 * 60 * 1000;
const RECENT_DISCONNECT_GRACE_MS = 10_000;

type PresenceRow = {
  id: string;
  admissionId: string;
  livekitIdentity: string;
  userId: string | null;
  role: "host" | "participant" | "guest";
  presenceStatus: "token_issued" | "connected" | "disconnected" | "aborted";
  tokenIssuedAt: Date;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
};

export interface ConnectedPresenceRecord {
  connectionId: string;
  admissionId: string;
  livekitIdentity: string;
  userId: string | null;
  role: "host" | "participant" | "guest";
}

function countsAsConnectedPresence(row: PresenceRow, now: Date): boolean {
  switch (row.presenceStatus) {
    case "connected":
      return true;
    case "token_issued":
      return now.getTime() - row.tokenIssuedAt.getTime() <= TOKEN_ISSUED_CAPACITY_GRACE_MS;
    case "disconnected":
    case "aborted":
      return false;
  }
}

function isWhiteboardEligiblePresence(row: PresenceRow, now: Date): boolean {
  if (row.presenceStatus === "connected") {
    return true;
  }

  if (row.presenceStatus === "token_issued") {
    return now.getTime() - row.tokenIssuedAt.getTime() <= TOKEN_ISSUED_WHITEBOARD_GRACE_MS;
  }

  if ((row.presenceStatus !== "disconnected" && row.presenceStatus !== "aborted") || !row.disconnectedAt) {
    return false;
  }

  return now.getTime() - row.disconnectedAt.getTime() <= RECENT_DISCONNECT_GRACE_MS;
}

function comparePresenceRecency(a: PresenceRow, b: PresenceRow): number {
  const rank = (row: PresenceRow) => {
    switch (row.presenceStatus) {
      case "connected":
        return 3;
      case "token_issued":
        return 2;
      case "disconnected":
      case "aborted":
        return 1;
    }
  };

  const rankDiff = rank(b) - rank(a);
  if (rankDiff !== 0) return rankDiff;

  const activityA =
    a.presenceStatus === "disconnected" || a.presenceStatus === "aborted"
      ? a.disconnectedAt?.getTime() ?? 0
      : a.connectedAt?.getTime() ?? a.tokenIssuedAt.getTime();
  const activityB =
    b.presenceStatus === "disconnected" || b.presenceStatus === "aborted"
      ? b.disconnectedAt?.getTime() ?? 0
      : b.connectedAt?.getTime() ?? b.tokenIssuedAt.getTime();

  return activityB - activityA;
}

function toPresenceRecord(row: PresenceRow): ConnectedPresenceRecord {
  return {
    connectionId: row.id,
    admissionId: row.admissionId,
    livekitIdentity: row.livekitIdentity,
    userId: row.userId,
    role: row.role,
  };
}

export async function findConnectedPresenceByAdmissionId(
  db: Database,
  meetingId: string,
  admissionId: string,
  now = new Date(),
): Promise<ConnectedPresenceRecord | null> {
  const projected = await db.query.meetingLivekitPresences.findMany({
    where: and(
      eq(meetingLivekitPresences.sessionId, meetingId),
      eq(meetingLivekitPresences.admissionId, admissionId),
      inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued"]),
    ),
    columns: {
      id: true,
      admissionId: true,
      livekitIdentity: true,
      userId: true,
      role: true,
      presenceStatus: true,
      tokenIssuedAt: true,
      connectedAt: true,
      disconnectedAt: true,
    },
  });

  const eligible = projected
    .filter((row) => countsAsConnectedPresence(row, now))
    .sort(comparePresenceRecency)[0];

  return eligible ? toPresenceRecord(eligible) : null;
}

export async function findWhiteboardEligiblePresenceByAdmissionId(
  db: Database,
  meetingId: string,
  admissionId: string,
  now = new Date(),
): Promise<ConnectedPresenceRecord | null> {
  const projected = await db.query.meetingLivekitPresences.findMany({
    where: and(
      eq(meetingLivekitPresences.sessionId, meetingId),
      eq(meetingLivekitPresences.admissionId, admissionId),
      inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued", "disconnected", "aborted"]),
    ),
    columns: {
      id: true,
      admissionId: true,
      livekitIdentity: true,
      userId: true,
      role: true,
      presenceStatus: true,
      tokenIssuedAt: true,
      connectedAt: true,
      disconnectedAt: true,
    },
  });

  const eligible = projected
    .filter((row) => isWhiteboardEligiblePresence(row, now))
    .sort(comparePresenceRecency)[0];

  return eligible ? toPresenceRecord(eligible) : null;
}

export async function findWhiteboardEligiblePresenceByConnectionId(
  db: Database,
  meetingId: string,
  connectionId: string,
  now = new Date(),
): Promise<ConnectedPresenceRecord | null> {
  const projected = await db.query.meetingLivekitPresences.findFirst({
    where: and(
      eq(meetingLivekitPresences.sessionId, meetingId),
      eq(meetingLivekitPresences.id, connectionId),
      inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued", "disconnected", "aborted"]),
    ),
    columns: {
      id: true,
      admissionId: true,
      livekitIdentity: true,
      userId: true,
      role: true,
      presenceStatus: true,
      tokenIssuedAt: true,
      connectedAt: true,
      disconnectedAt: true,
    },
  });

  if (!projected) return null;

  return isWhiteboardEligiblePresence(projected, now) ? toPresenceRecord(projected) : null;
}

export async function findConnectedPresenceByUserId(
  db: Database,
  meetingId: string,
  userId: string,
  now = new Date(),
): Promise<ConnectedPresenceRecord | null> {
  const projected = await db.query.meetingLivekitPresences.findMany({
    where: and(
      eq(meetingLivekitPresences.sessionId, meetingId),
      eq(meetingLivekitPresences.userId, userId),
      inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued"]),
    ),
    columns: {
      id: true,
      admissionId: true,
      livekitIdentity: true,
      userId: true,
      role: true,
      presenceStatus: true,
      tokenIssuedAt: true,
      connectedAt: true,
      disconnectedAt: true,
    },
  });

  const eligible = projected
    .filter((row) => countsAsConnectedPresence(row, now))
    .sort(comparePresenceRecency)[0];

  return eligible ? toPresenceRecord(eligible) : null;
}

export async function listConnectedPresence(
  db: Database,
  meetingId: string,
): Promise<ConnectedPresenceRecord[]> {
  const projected = await db
    .select({
      connectionId: meetingLivekitPresences.id,
      admissionId: meetingLivekitPresences.admissionId,
      livekitIdentity: meetingLivekitPresences.livekitIdentity,
      userId: meetingLivekitPresences.userId,
      role: meetingLivekitPresences.role,
    })
    .from(meetingLivekitPresences)
    .where(
      and(
        eq(meetingLivekitPresences.sessionId, meetingId),
        eq(meetingLivekitPresences.presenceStatus, "connected"),
      ),
    );

  return projected.map((row) => ({
    connectionId: row.connectionId,
    admissionId: row.admissionId,
    livekitIdentity: row.livekitIdentity,
    userId: row.userId,
    role: row.role,
  }));
}

export async function isMeetingAtSoftCapacity(
  db: Database,
  meetingId: string,
  maxParticipants: number | null,
): Promise<boolean> {
  if (maxParticipants === null) return false;
  const tokenIssuedCutoff = new Date(Date.now() - TOKEN_ISSUED_CAPACITY_GRACE_MS);
  const [row] = await db
    .select({ activeCount: count() })
    .from(meetingLivekitPresences)
    .where(
      and(
        eq(meetingLivekitPresences.sessionId, meetingId),
        or(
          eq(meetingLivekitPresences.presenceStatus, "connected"),
          and(
            eq(meetingLivekitPresences.presenceStatus, "token_issued"),
            gte(meetingLivekitPresences.tokenIssuedAt, tokenIssuedCutoff),
          ),
        ),
      ),
    );

  return (row?.activeCount ?? 0) >= maxParticipants;
}
