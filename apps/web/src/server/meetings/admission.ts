import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";
import { meetingSessions, rooms, meetingParticipants } from "@ossmeet/db/schema";
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
import { withD1Retry } from "@/lib/db-utils";

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

    const room = await db.query.rooms.findFirst({
      where: eq(rooms.code, data.code),
      with: { host: { columns: { plan: true, name: true } } },
    });

    if (!room || room.archivedAt) return { exists: false } as const;
    if (room.expiresAt && room.expiresAt < new Date()) return { exists: false } as const;

    const hostPlan = (room.host?.plan as PlanType) ?? "free";
    if (room.type === "permanent" && hostPlan === "free") {
      return { exists: false } as const;
    }

    const activeSession = await db.query.meetingSessions.findFirst({
      where: and(eq(meetingSessions.roomId, room.id), eq(meetingSessions.status, "active")),
      columns: { id: true, locked: true },
    });

    if (room.type === "instant" && !activeSession) {
      return { exists: false } as const;
    }

    return {
      exists: true,
      kind: room.type,
      title: room.title,
      requireApproval: room.requireApproval,
      allowGuests: room.allowGuests,
      hasActiveSession: Boolean(activeSession),
      locked: activeSession?.locked ?? false,
      hostName: room.host?.name ?? null,
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

    const rows = await db
      .select({
        id: meetingParticipants.id,
        displayName: meetingParticipants.displayName,
        role: meetingParticipants.role,
        joinedAt: meetingParticipants.joinedAt,
        userId: meetingParticipants.userId,
      })
      .from(meetingParticipants)
      .where(and(eq(meetingParticipants.sessionId, meeting.id), eq(meetingParticipants.status, "awaiting_approval")))
      .orderBy(asc(meetingParticipants.joinedAt), asc(meetingParticipants.id));

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

    await withD1Retry(() =>
      db
        .update(meetingParticipants)
        .set({ status: "pending" })
        .where(
          and(
            eq(meetingParticipants.id, data.participantId),
            eq(meetingParticipants.sessionId, meeting.id),
            eq(meetingParticipants.status, "awaiting_approval"),
          ),
        ),
    );

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

    await withD1Retry(() =>
      db
        .update(meetingParticipants)
        .set({ status: "denied", leftAt: new Date() })
        .where(
          and(
            eq(meetingParticipants.id, data.participantId),
            eq(meetingParticipants.sessionId, meeting.id),
            eq(meetingParticipants.status, "awaiting_approval"),
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
    const { getEnv, requireAuth, getGuestCookieSecret } = await import(
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

    const participant = await db.query.meetingParticipants.findFirst({
      where: and(eq(meetingParticipants.id, data.participantId), eq(meetingParticipants.sessionId, data.sessionId)),
    });
    if (!participant) return { state: "gone" as const };

    if (userId) {
      if (participant.userId !== userId) throw Errors.FORBIDDEN();
    } else {
      if (participant.userId !== null) throw Errors.FORBIDDEN();
      const cookieSecret = getGuestCookieSecret(data.participantId);
      if (!cookieSecret || !participant.guestSecret) throw Errors.FORBIDDEN();
      if (!(await verifyGuestSecret(participant.guestSecret, cookieSecret))) throw Errors.FORBIDDEN();
    }

    if (participant.status === "awaiting_approval") return { state: "pending" as const };
    if (participant.status === "denied") return { state: "denied" as const };
    if (participant.status === "pending" || participant.status === "active") return { state: "admitted" as const };
    return { state: "gone" as const };
  });
