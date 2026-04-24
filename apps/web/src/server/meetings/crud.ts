import { createServerFn } from "@tanstack/react-start";
import { meetingArtifacts, meetingSessions, rooms, meetingParticipants, meetingSummaries, spaceMembers, spaces, users } from "@ossmeet/db/schema";
import { eq, and, isNull, asc, desc, count, inArray } from "drizzle-orm";
import {
  CURRENT_MEETING_PARTICIPANT_STATUSES,
  createMeetingSchema,
  getMeetingSchema,
  meetingParticipantsSchema,
  Errors,
  getPlanLimits,
  generateMeetingCode,
  generateId,
  ROOM_EXPIRY_MS,
} from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import { logError } from "@/lib/logger";
import { withD1Retry } from "@/lib/db-utils";
import { finalizeMeetingEnd, finalizeMeetingsEnd } from "./finalize";

const AUTH_HELPERS_MODULE = "../auth/helpers";
const LEAVE_END_MODULE = "./leave-end";

function createSessionSlug(now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 4);
  return `${day}-${suffix}`;
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
    const { terminateMeetingRoom } = await import(/* @vite-ignore */ LEAVE_END_MODULE);
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
    let roomId = generateId("ROOM");
    let sessionId = generateId("MEETING_SESSION");
    let code = data.customCode ?? generateMeetingCode();

    for (let attempt = 0; attempt < 3; attempt++) {
      roomId = generateId("ROOM");
      sessionId = generateId("MEETING_SESSION");
      if (!data.customCode && attempt > 0) code = generateMeetingCode();

      try {
        await withD1Retry(() =>
          db.batch([
            db.insert(rooms).values({
              id: roomId,
              code,
              type: roomType,
              hostId: user.id,
              spaceId: data.spaceId ?? null,
              title: data.title ?? null,
              allowGuests: data.allowGuests,
              recordingEnabled,
              requireApproval: data.requireApproval,
              lastUsedAt: now,
              expiresAt: data.permanent ? new Date(now.getTime() + ROOM_EXPIRY_MS) : null,
              createdAt: now,
              updatedAt: now,
            }),
            db.insert(meetingSessions).values({
              id: sessionId,
              roomId,
              publicSlug: createSessionSlug(now),
              title: data.title ?? null,
              hostId: user.id,
              spaceId: data.spaceId ?? null,
              allowGuests: data.allowGuests,
              recordingEnabled,
              requireApproval: data.requireApproval,
              startedAt: now,
              updatedAt: now,
            }),
          ]),
        );
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (data.customCode && msg.includes("UNIQUE")) {
          throw Errors.CONFLICT("That meeting code is already taken. Please choose a different one.");
        }
        if (!msg.includes("UNIQUE") || attempt === 2) {
          logError("[rooms] Failed to create room/session:", { attempt, roomId, sessionId, code }, err);
          throw err;
        }
      }
    }

    if (limits.maxConcurrentMeetings !== null) {
      const activeMeetings = await db
        .select({ id: meetingSessions.id, activeEgressId: meetingSessions.activeEgressId })
        .from(meetingSessions)
        .where(and(eq(meetingSessions.hostId, user.id), eq(meetingSessions.status, "active")))
        .orderBy(asc(meetingSessions.startedAt));

      if (activeMeetings.length > limits.maxConcurrentMeetings) {
        const toEnd = activeMeetings.slice(0, activeMeetings.length - limits.maxConcurrentMeetings);

        if (toEnd.some((m) => m.id === sessionId)) {
          await finalizeMeetingEnd(db, {
            meetingId: sessionId,
            hostPlan: plan,
            now,
            onlyActive: true,
          });
          throw Errors.PLAN_LIMIT_REACHED(`Maximum ${limits.maxConcurrentMeetings} concurrent meeting(s) on your plan`);
        }

        await finalizeMeetingsEnd(db, {
          meetingIds: toEnd.map((m) => m.id),
          hostPlan: plan,
          now,
          onlyActive: true,
        });

        await Promise.allSettled(
          toEnd.map((m) => terminateMeetingRoom(env, m.id, m.activeEgressId).catch((err: unknown) => {
            logError("[meetingSessions] LiveKit cleanup failed:", err);
          })),
        );
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
      with: {
        participants: {
          where: inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
        },
      },
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
    const isParticipant = meeting.participants.some((p) => p.userId === user.id);
    if (!isHost && !isParticipant) throw Errors.FORBIDDEN();

    const participants = meeting.participants.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      role: p.role,
      joinedAt: p.joinedAt,
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
  .inputValidator(meetingParticipantsSchema)
  .handler(async ({ data, context: { user, env, db } }) => {
    const { enforceRateLimit } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    await enforceRateLimit(env, `meeting:participants:${user.id}`);

    const callerParticipant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.sessionId, data.sessionId),
        eq(meetingParticipants.userId, user.id),
        inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
      ),
    });
    if (!callerParticipant) throw Errors.FORBIDDEN();

    const participants = await db
      .select({
        id: meetingParticipants.id,
        displayName: meetingParticipants.displayName,
        role: meetingParticipants.role,
        joinedAt: meetingParticipants.joinedAt,
      })
      .from(meetingParticipants)
      .where(
        and(
          eq(meetingParticipants.sessionId, data.sessionId),
          inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
        ),
      )
      .orderBy(asc(meetingParticipants.joinedAt), asc(meetingParticipants.id))
      .limit(200);

    return {
      participants: participants.map((item) => ({
        ...item,
        joinedAt: item.joinedAt?.toISOString() ?? null,
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
        meetingParticipants,
        and(
          eq(meetingParticipants.sessionId, meetingSessions.id),
          eq(meetingParticipants.userId, user.id),
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
          .select({ sessionId: meetingParticipants.sessionId, count: count() })
          .from(meetingParticipants)
          .where(inArray(meetingParticipants.sessionId, sessionIds))
          .groupBy(meetingParticipants.sessionId),
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
