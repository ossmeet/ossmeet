import { createServerFn } from "@tanstack/react-start";
import type { Database } from "@ossmeet/db";
import { meetingAdmissions, meetingArtifacts, meetingLivekitPresences, meetingSessions, rooms, meetingSummaries, spaceMembers, spaces, users } from "@ossmeet/db/schema";
import { eq, and, isNull, asc, desc, count, inArray, sql } from "drizzle-orm";
import {
  createMeetingSchema,
  getMeetingSchema,
  meetingLivekitPresencesListSchema,
  Errors,
  getPlanLimits,
  generateMeetingCode,
  generateId,
  ROOM_EXPIRY_MS,
} from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import { logError } from "@/lib/logger";
import { getRunChanges, withD1Retry } from "@/lib/db-utils";
import { createSessionSlug } from "@/lib/meeting/session-slug";

const AUTH_HELPERS_MODULE = "../auth/helpers";

export async function insertRoomAndInitialSession(
  db: Database,
  params: {
    roomId: string;
    sessionId: string;
    code: string;
    publicSlug: string;
    hostId: string;
    spaceId: string | null;
    title: string | null;
    roomType: "instant" | "permanent";
    allowGuests: boolean;
    recordingEnabled: boolean;
    requireApproval: boolean;
    now: Date;
    maxConcurrentMeetings: number | null;
  },
): Promise<boolean> {
  const {
    roomId,
    sessionId,
    code,
    publicSlug,
    hostId,
    spaceId,
    title,
    roomType,
    allowGuests,
    recordingEnabled,
    requireApproval,
    now,
    maxConcurrentMeetings,
  } = params;

  if (maxConcurrentMeetings === null) {
    await withD1Retry(() =>
      db.batch([
        db.insert(rooms).values({
          id: roomId,
          code,
          type: roomType,
          hostId,
          spaceId,
          title,
          allowGuests,
          recordingEnabled,
          requireApproval,
          lastUsedAt: now,
          expiresAt: roomType === "permanent" ? new Date(now.getTime() + ROOM_EXPIRY_MS) : null,
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(meetingSessions).values({
          id: sessionId,
          roomId,
          publicSlug,
          title,
          hostId,
          spaceId,
          allowGuests,
          recordingEnabled,
          requireApproval,
          startedAt: now,
          updatedAt: now,
        }),
      ]),
    );
    return true;
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds =
    roomType === "permanent"
      ? Math.floor((now.getTime() + ROOM_EXPIRY_MS) / 1000)
      : null;

  const [roomInsertResult, sessionInsertResult] = await withD1Retry(() =>
    db.batch([
      db.insert(rooms).select(sql`
        select
          ${roomId},
          ${code},
          ${roomType},
          ${hostId},
          ${spaceId},
          ${title},
          ${allowGuests ? 1 : 0},
          ${recordingEnabled ? 1 : 0},
          ${requireApproval ? 1 : 0},
          ${nowSeconds},
          ${expiresAtSeconds},
          ${null},
          ${nowSeconds},
          ${nowSeconds}
        where (
          select count(*)
          from meeting_sessions
          where host_id = ${hostId}
            and status = 'active'
        ) < ${maxConcurrentMeetings}
      `),
      db.insert(meetingSessions).select(sql`
        select
          ${sessionId},
          ${roomId},
          ${publicSlug},
          ${title},
          ${hostId},
          ${spaceId},
          ${"active"},
          ${allowGuests ? 1 : 0},
          ${recordingEnabled ? 1 : 0},
          ${requireApproval ? 1 : 0},
          ${0},
          ${null},
          ${null},
          ${nowSeconds},
          ${null},
          ${null},
          ${nowSeconds}
        where exists (
          select 1
          from rooms
          where id = ${roomId}
        )
      `),
    ]),
  );

  const roomInserted = getRunChanges(roomInsertResult) > 0;
  const sessionInserted = getRunChanges(sessionInsertResult) > 0;

  if (!roomInserted) return false;
  if (!sessionInserted) {
    throw Errors.VALIDATION("Failed to create meeting, please try again");
  }
  return true;
}

/**
 * Create a room and immediately start its first session.
 * The returned `code` is the only human-facing meeting identifier.
 */
export const createMeeting = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(createMeetingSchema)
  .handler(async ({ data, context: { user, env, db } }) => {
    const { enforceRateLimit } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    await enforceRateLimit(env, `meeting:create:${user.id}`);

    const plan = (user.plan as PlanType) ?? "free";
    const limits = getPlanLimits(plan);

    if (data.permanent && !limits.reusableMeetingLink) {
      throw Errors.FORBIDDEN("Permanent meeting rooms require a Pro or Org plan");
    }
    if (data.customCode && !limits.customMeetingCode) {
      throw Errors.FORBIDDEN("Custom meeting codes require a Pro or Org plan");
    }
    if (data.customCode && !data.permanent) {
      throw Errors.VALIDATION("Custom meeting codes require a permanent room");
    }

    if (data.spaceId) {
      const spaceCheck = await db.query.spaces.findFirst({
        where: and(eq(spaces.id, data.spaceId), isNull(spaces.archivedAt)),
        columns: { id: true },
      });
      if (!spaceCheck) throw Errors.NOT_FOUND("Space");

      const membership = await db.query.spaceMembers.findFirst({
        where: and(eq(spaceMembers.spaceId, data.spaceId), eq(spaceMembers.userId, user.id)),
      });
      if (!membership) throw Errors.FORBIDDEN();
    }

    const now = new Date();
    const roomType = data.permanent ? "permanent" : "instant";
    const recordingEnabled = data.recordingEnabled && limits.recordingEnabled;
    const MAX_CODE_COLLISION_ATTEMPTS = 3;

    let roomId = "";
    let sessionId = "";
    let code = data.customCode ?? generateMeetingCode();

    for (let attempt = 0; attempt < MAX_CODE_COLLISION_ATTEMPTS; attempt++) {
      roomId = generateId("ROOM");
      sessionId = generateId("MEETING_SESSION");
      if (!data.customCode && attempt > 0) code = generateMeetingCode();

      try {
        const created = await insertRoomAndInitialSession(db, {
          roomId,
          sessionId,
          code,
          publicSlug: createSessionSlug(now),
          hostId: user.id,
          spaceId: data.spaceId ?? null,
          title: data.title ?? null,
          roomType,
          allowGuests: data.allowGuests,
          recordingEnabled,
          requireApproval: data.requireApproval,
          now,
          maxConcurrentMeetings: limits.maxConcurrentMeetings,
        });
        if (created) break;

        // Capacity rejection — retrying with a different code will not help.
        throw Errors.PLAN_LIMIT_REACHED(
          `Maximum ${limits.maxConcurrentMeetings} concurrent meeting(s) on your plan`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const isUniqueCollision = msg.includes("UNIQUE");

        if (isUniqueCollision && data.customCode) {
          throw Errors.CONFLICT("That meeting code is already taken. Please choose a different one.");
        }
        if (!isUniqueCollision || attempt === MAX_CODE_COLLISION_ATTEMPTS - 1) {
          logError("[rooms] Failed to create room/session:", { attempt, roomId, sessionId, code }, err);
          throw err;
        }
        // else: retry with a fresh generated code
      }
    }

    return { sessionId, meetingId: sessionId, roomId, code, permanent: data.permanent ?? false };
  });

/** Get active session details by room code. */
export const getMeeting = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(getMeetingSchema)
  .handler(async ({ data, context: { user, db } }) => {
    const room = await db.query.rooms.findFirst({ where: eq(rooms.code, data.code) });
    if (!room || room.archivedAt) throw Errors.NOT_FOUND("Meeting");

    const meeting = await db.query.meetingSessions.findFirst({
      where: and(eq(meetingSessions.roomId, room.id), eq(meetingSessions.status, "active")),
    });
    if (!meeting) throw Errors.NOT_FOUND("Meeting");

    if (meeting.spaceId) {
      const activeSpace = await db.query.spaces.findFirst({
        where: and(eq(spaces.id, meeting.spaceId), isNull(spaces.archivedAt)),
        columns: { id: true },
      });
      if (!activeSpace) throw Errors.NOT_FOUND("Meeting");
    }

    const isHost = meeting.hostId === user.id;
    const connectedParticipants = await db
      .select({
        id: meetingLivekitPresences.admissionId,
        connectionId: meetingLivekitPresences.id,
        displayName: meetingAdmissions.displayName,
        role: meetingLivekitPresences.role,
        joinedAt: meetingLivekitPresences.connectedAt,
        tokenIssuedAt: meetingLivekitPresences.tokenIssuedAt,
        userId: meetingLivekitPresences.userId,
      })
      .from(meetingLivekitPresences)
      .innerJoin(meetingAdmissions, eq(meetingAdmissions.id, meetingLivekitPresences.admissionId))
      .where(
        and(
          eq(meetingLivekitPresences.sessionId, meeting.id),
          eq(meetingLivekitPresences.presenceStatus, "connected"),
        ),
      )
      .orderBy(asc(meetingLivekitPresences.connectedAt), asc(meetingLivekitPresences.tokenIssuedAt), asc(meetingLivekitPresences.id));

    const isParticipant = connectedParticipants.some((p) => p.userId === user.id);
    if (!isHost && !isParticipant) throw Errors.FORBIDDEN();

    const participants = connectedParticipants.map((p) => ({
      id: p.id ?? p.connectionId,
      displayName: p.displayName ?? p.userId ?? "Guest",
      role: p.role,
      joinedAt: p.joinedAt ?? p.tokenIssuedAt,
      ...(isHost ? { userId: p.userId } : {}),
    }));

    return {
      meeting: {
        id: meeting.id,
        sessionId: meeting.id,
        roomId: room.id,
        code: room.code,
        title: meeting.title,
        status: meeting.status,
        startedAt: meeting.startedAt,
        endedAt: meeting.endedAt,
        allowGuests: meeting.allowGuests,
        spaceId: meeting.spaceId,
        updatedAt: meeting.updatedAt,
        participants,
        ...(isHost ? {
          hostId: meeting.hostId,
          activeEgressId: meeting.activeEgressId,
          recordingEnabled: meeting.recordingEnabled,
        } : {}),
      },
    };
  });

/** Get meeting participants for an active internal session. */
export const getMeetingParticipants = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(meetingLivekitPresencesListSchema)
  .handler(async ({ data, context: { user, env, db } }) => {
    const { enforceRateLimit } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    await enforceRateLimit(env, `meeting:participants:${user.id}`);

    const callerParticipant = await db.query.meetingLivekitPresences.findFirst({
      where: and(
        eq(meetingLivekitPresences.sessionId, data.sessionId),
        eq(meetingLivekitPresences.userId, user.id),
        eq(meetingLivekitPresences.presenceStatus, "connected"),
      ),
    });
    if (!callerParticipant) throw Errors.FORBIDDEN();

    const participants = await db
      .select({
        id: meetingLivekitPresences.admissionId,
        connectionId: meetingLivekitPresences.id,
        displayName: meetingAdmissions.displayName,
        role: meetingLivekitPresences.role,
        joinedAt: meetingLivekitPresences.connectedAt,
        tokenIssuedAt: meetingLivekitPresences.tokenIssuedAt,
      })
      .from(meetingLivekitPresences)
      .innerJoin(meetingAdmissions, eq(meetingAdmissions.id, meetingLivekitPresences.admissionId))
      .where(
        and(
          eq(meetingLivekitPresences.sessionId, data.sessionId),
          eq(meetingLivekitPresences.presenceStatus, "connected"),
        ),
      )
      .orderBy(asc(meetingLivekitPresences.connectedAt), asc(meetingLivekitPresences.tokenIssuedAt), asc(meetingLivekitPresences.id))
      .limit(200);

    return {
      participants: participants.map((item) => ({
        id: item.id ?? item.connectionId,
        displayName: item.displayName ?? "Guest",
        role: item.role,
        joinedAt: (item.joinedAt ?? item.tokenIssuedAt)?.toISOString() ?? null,
      })),
    };
  });

/** Get recent ended sessions for the current user. */
export const getMyRecentMeetings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { user, db } }) => {
    const rows = await db
      .select({
        id: meetingSessions.id,
        sessionId: meetingSessions.id,
        roomId: rooms.id,
        code: rooms.code,
        sessionSlug: meetingSessions.publicSlug,
        title: meetingSessions.title,
        status: meetingSessions.status,
        startedAt: meetingSessions.startedAt,
        endedAt: meetingSessions.endedAt,
        spaceId: meetingSessions.spaceId,
        spaceName: spaces.name,
        hostName: users.name,
        hasSummary: meetingSummaries.id,
        isHost: meetingSessions.hostId,
      })
      .from(meetingSessions)
      .innerJoin(
        meetingLivekitPresences,
        and(
          eq(meetingLivekitPresences.sessionId, meetingSessions.id),
          eq(meetingLivekitPresences.userId, user.id),
        ),
      )
      .innerJoin(rooms, eq(meetingSessions.roomId, rooms.id))
      .leftJoin(spaces, eq(meetingSessions.spaceId, spaces.id))
      .innerJoin(users, eq(meetingSessions.hostId, users.id))
      .leftJoin(meetingSummaries, eq(meetingSummaries.sessionId, meetingSessions.id))
      .where(eq(meetingSessions.status, "ended"))
      .groupBy(
        meetingSessions.id,
        rooms.id,
        rooms.code,
        meetingSessions.publicSlug,
        meetingSessions.title,
        meetingSessions.status,
        meetingSessions.startedAt,
        meetingSessions.endedAt,
        meetingSessions.spaceId,
        spaces.name,
        meetingSessions.hostId,
        users.name,
        meetingSummaries.id,
      )
      .orderBy(desc(meetingSessions.startedAt))
      .limit(20);

    const sessionIds = rows.map((r) => r.id);
    let participantCounts: { sessionId: string; count: number }[] = [];
    let whiteboardArtifacts: { sessionId: string; type: string }[] = [];

    if (sessionIds.length > 0) {
      const [counts, artifacts] = await Promise.all([
        db
          .select({ sessionId: meetingLivekitPresences.sessionId, count: count() })
          .from(meetingLivekitPresences)
          .where(inArray(meetingLivekitPresences.sessionId, sessionIds))
          .groupBy(meetingLivekitPresences.sessionId),
        db
          .select({ sessionId: meetingArtifacts.sessionId, type: meetingArtifacts.type })
          .from(meetingArtifacts)
          .where(
            and(
              inArray(meetingArtifacts.sessionId, sessionIds),
              inArray(meetingArtifacts.type, ["whiteboard_state", "whiteboard_pdf"]),
            ),
          ),
      ]);

      participantCounts = counts;
      whiteboardArtifacts = artifacts;
    }

    const countMap = new Map(participantCounts.map((c) => [c.sessionId, c.count]));
    const whiteboardStateSessionIds = new Set(
      whiteboardArtifacts.filter((artifact) => artifact.type === "whiteboard_state").map((artifact) => artifact.sessionId),
    );
    const whiteboardPdfSessionIds = new Set(
      whiteboardArtifacts.filter((artifact) => artifact.type === "whiteboard_pdf").map((artifact) => artifact.sessionId),
    );

    return {
      meetings: rows.map((m) => ({
        ...m,
        hasSummary: Boolean(m.hasSummary),
        isHost: m.isHost === user.id,
        hasWhiteboardState: whiteboardStateSessionIds.has(m.id),
        hasWhiteboardPdf: whiteboardPdfSessionIds.has(m.id),
        participantCount: countMap.get(m.id) ?? 0,
        startedAt: m.startedAt?.toISOString() ?? null,
        endedAt: m.endedAt?.toISOString() ?? null,
      })),
    };
  });
