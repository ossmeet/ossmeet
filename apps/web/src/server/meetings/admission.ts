import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";
import { meetingAdmissions, meetingSessions, rooms, meetingLivekitPresences, users } from "@ossmeet/db/schema";
import { eq, and, asc } from "drizzle-orm";
import {
  admissionDecisionSchema,
  toggleMeetingLockSchema,
  listPendingAdmissionsSchema,
  lookupMeetingSchema,
  refreshMeetingTokenSchema,
  Errors,
  AppError,
  type PlanType,
} from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import { verifyGuestSecret } from "@/lib/auth/crypto";
import { getRunChanges, withD1Retry } from "@/lib/db-utils";
import { expireStaleAwaitingParticipants } from "./waiting-room";

const AUTH_HELPERS_MODULE = "../auth/helpers";

/** Public, unauthenticated pre-flight lookup for a room code. */
export const lookupMeeting = createServerFn({ method: "GET" })
  .inputValidator(lookupMeetingSchema)
  .handler(async ({ data }) => {
    const { getEnv, getClientIP, enforceRateLimit } = await import(
      /* @vite-ignore */ AUTH_HELPERS_MODULE
    );
    const env = await getEnv();
    const db = createDb(env.DB);

    await enforceRateLimit(env, `meeting:lookup:${getClientIP()}`);

    const row = await db
      .select({
        room: {
          id: rooms.id,
          type: rooms.type,
          title: rooms.title,
          allowGuests: rooms.allowGuests,
          requireApproval: rooms.requireApproval,
          expiresAt: rooms.expiresAt,
          archivedAt: rooms.archivedAt,
        },
        host: {
          plan: users.plan,
          name: users.name,
        },
        activeSession: {
          id: meetingSessions.id,
          locked: meetingSessions.locked,
        },
      })
      .from(rooms)
      .innerJoin(users, eq(users.id, rooms.hostId))
      .leftJoin(
        meetingSessions,
        and(eq(meetingSessions.roomId, rooms.id), eq(meetingSessions.status, "active")),
      )
      .where(eq(rooms.code, data.code))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    const room = row?.room;
    if (!row || !room || room.archivedAt) return { exists: false } as const;
    if (room.expiresAt && room.expiresAt < new Date()) return { exists: false } as const;

    const hostPlan = (row.host.plan as PlanType) ?? "free";
    if (room.type === "permanent" && hostPlan === "free") {
      return { exists: false } as const;
    }

    if (room.type === "instant" && !row.activeSession) {
      return { exists: false } as const;
    }

    return {
      exists: true,
      kind: room.type,
      title: room.title,
      requireApproval: room.requireApproval,
      allowGuests: room.allowGuests,
      hasActiveSession: Boolean(row.activeSession),
      locked: row.activeSession?.locked ?? false,
      hostName: row.host.name ?? null,
      requiresAuth: !room.allowGuests,
    } as const;
  });

export const listPendingAdmissions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(listPendingAdmissionsSchema)
  .handler(async ({ data, context: { user, db } }) => {
    const meeting = await db.query.meetingSessions.findFirst({
      where: and(eq(meetingSessions.id, data.sessionId), eq(meetingSessions.status, "active")),
      columns: { id: true, hostId: true, locked: true, requireApproval: true },
    });
    if (!meeting) throw Errors.NOT_FOUND("Meeting");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    await expireStaleAwaitingParticipants(db, meeting.id);

    const rows = await db
      .select({
        id: meetingAdmissions.id,
        displayName: meetingAdmissions.displayName,
        role: meetingAdmissions.requestedRole,
        joinedAt: meetingAdmissions.createdAt,
        userId: meetingAdmissions.subjectUserId,
      })
      .from(meetingAdmissions)
      .where(and(eq(meetingAdmissions.sessionId, meeting.id), eq(meetingAdmissions.admissionStatus, "awaiting_approval")))
      .orderBy(asc(meetingAdmissions.createdAt), asc(meetingAdmissions.id));

    return {
      locked: meeting.locked,
      requireApproval: meeting.requireApproval,
      pending: rows.map((r) => ({
        ...r,
        joinedAt: r.joinedAt?.toISOString() ?? null,
      })),
    };
  });

export const admitParticipant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(admissionDecisionSchema)
  .handler(async ({ data, context: { user, db } }) => {
    const meeting = await db.query.meetingSessions.findFirst({
      where: and(eq(meetingSessions.id, data.sessionId), eq(meetingSessions.status, "active")),
      columns: { id: true, hostId: true },
    });
    if (!meeting) throw Errors.NOT_FOUND("Meeting");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    await expireStaleAwaitingParticipants(db, meeting.id);

    const targetAdmission = await db.query.meetingAdmissions.findFirst({
      where: and(
        eq(meetingAdmissions.id, data.admissionId),
        eq(meetingAdmissions.sessionId, meeting.id),
        eq(meetingAdmissions.admissionStatus, "awaiting_approval"),
      ),
      columns: { id: true, requestedRole: true },
    });
    if (!targetAdmission) {
      throw Errors.CONFLICT("Participant is no longer awaiting approval");
    }

    const now = new Date();
    const admissionResult = await withD1Retry(() =>
      db
        .update(meetingAdmissions)
        .set({
          admissionStatus: "approved",
          grantedRole: targetAdmission.requestedRole,
          decidedByUserId: user.id,
          decidedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(meetingAdmissions.id, targetAdmission.id),
            eq(meetingAdmissions.sessionId, meeting.id),
            eq(meetingAdmissions.admissionStatus, "awaiting_approval"),
          ),
        )
        .run(),
    );

    if (getRunChanges(admissionResult) === 0) {
      throw Errors.CONFLICT("Participant is no longer awaiting approval");
    }

    return { success: true };
  });

export const denyParticipant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(admissionDecisionSchema)
  .handler(async ({ data, context: { user, db } }) => {
    const meeting = await db.query.meetingSessions.findFirst({
      where: and(eq(meetingSessions.id, data.sessionId), eq(meetingSessions.status, "active")),
      columns: { id: true, hostId: true },
    });
    if (!meeting) throw Errors.NOT_FOUND("Meeting");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    await expireStaleAwaitingParticipants(db, meeting.id);

    const targetAdmission = await db.query.meetingAdmissions.findFirst({
      where: and(
        eq(meetingAdmissions.id, data.admissionId),
        eq(meetingAdmissions.sessionId, meeting.id),
        eq(meetingAdmissions.admissionStatus, "awaiting_approval"),
      ),
      columns: { id: true },
    });
    if (!targetAdmission) {
      throw Errors.CONFLICT("Participant is no longer awaiting approval");
    }

    const now = new Date();
    await withD1Retry(() =>
      db
        .update(meetingAdmissions)
        .set({ admissionStatus: "denied", decidedByUserId: user.id, decidedAt: now, updatedAt: now })
        .where(
          and(
            eq(meetingAdmissions.id, targetAdmission.id),
            eq(meetingAdmissions.sessionId, meeting.id),
            eq(meetingAdmissions.admissionStatus, "awaiting_approval"),
          ),
        ),
    );

    return { success: true };
  });

export const toggleMeetingLock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(toggleMeetingLockSchema)
  .handler(async ({ data, context: { user, db } }) => {
    const meeting = await db.query.meetingSessions.findFirst({
      where: and(eq(meetingSessions.id, data.sessionId), eq(meetingSessions.status, "active")),
      columns: { id: true, hostId: true },
    });
    if (!meeting) throw Errors.NOT_FOUND("Meeting");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    await withD1Retry(() =>
      db.update(meetingSessions).set({ locked: data.locked, updatedAt: new Date() }).where(eq(meetingSessions.id, meeting.id)),
    );

    return { success: true, locked: data.locked };
  });

export const checkAdmissionStatus = createServerFn({ method: "GET" })
  .inputValidator(refreshMeetingTokenSchema)
  .handler(async ({ data }) => {
    const { getEnv, requireAuth, getGuestCookieSecret, getClientIP, enforceRateLimit } = await import(
      /* @vite-ignore */ AUTH_HELPERS_MODULE
    );
    const env = await getEnv();
    const db = createDb(env.DB);

    let userId: string | null = null;
    try {
      const u = await requireAuth();
      userId = u.id;
    } catch (err) {
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;
    }

    await enforceRateLimit(
      env,
      `meeting:admission-status:${data.sessionId}:${userId ?? getClientIP()}`,
    );
    await expireStaleAwaitingParticipants(db, data.sessionId);

    const connection = await db.query.meetingLivekitPresences.findFirst({
      where: and(eq(meetingLivekitPresences.id, data.connectionId), eq(meetingLivekitPresences.sessionId, data.sessionId)),
      columns: { admissionId: true, userId: true },
    });
    if (!connection) return { state: "gone" as const };

    const admission = await db.query.meetingAdmissions.findFirst({
      where: and(
        eq(meetingAdmissions.id, connection.admissionId),
        eq(meetingAdmissions.sessionId, data.sessionId),
      ),
      columns: { id: true, admissionStatus: true, guestSecretHash: true },
    });
    if (!admission) return { state: "gone" as const };

    if (userId) {
      if (connection?.userId !== userId) throw Errors.FORBIDDEN();
    } else {
      if (connection?.userId !== null) throw Errors.FORBIDDEN();
      const cookieSecret = getGuestCookieSecret(admission.id);
      if (!cookieSecret || !admission.guestSecretHash) throw Errors.FORBIDDEN();
      if (!(await verifyGuestSecret(admission.guestSecretHash, cookieSecret))) throw Errors.FORBIDDEN();
    }

    if (admission?.admissionStatus === "awaiting_approval") return { state: "pending" as const };
    if (admission?.admissionStatus === "denied" || admission?.admissionStatus === "revoked") return { state: "denied" as const };
    if (admission?.admissionStatus === "approved") return { state: "admitted" as const };
    return { state: "gone" as const };
  });
