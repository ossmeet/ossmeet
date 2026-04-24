import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";
import { meetingSessions, rooms, meetingParticipants } from "@ossmeet/db/schema";
import { eq, and, count, inArray, isNull, asc } from "drizzle-orm";
import {
  CURRENT_MEETING_PARTICIPANT_STATUSES,
  OCCUPYING_MEETING_PARTICIPANT_STATUSES,
  joinMeetingSchema,
  Errors,
  getPlanLimits,
  generateId,
  AppError,
  ROOM_EXPIRY_MS,
} from "@ossmeet/shared";
import type { PlanType, MeetingRole } from "@ossmeet/shared";
import { sanitizeDisplayName } from "@/lib/sanitize";
import { verifyGuestSecret, hashSessionToken } from "@/lib/auth/crypto";
import { withD1Retry } from "@/lib/db-utils";
import { assertSpaceMembershipIfNeeded } from "./access-assertions";

const AUTH_HELPERS_MODULE = "../auth/helpers";

function createSessionSlug(now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 4);
  return `${day}-${suffix}`;
}

/** Join a room by its public code and return LiveKit access for the active session. */
export const joinMeeting = createServerFn({ method: "POST" })
  .inputValidator(joinMeetingSchema)
  .handler(async ({ data }) => {
    const { enforceMeetingDurationLimit, issueMeetingAccess } = await import("./access.server");
    const {
      getEnv,
      requireAuth,
      getClientIP,
      enforceRateLimit,
      setGuestCookie,
      getGuestCookieSecret,
    } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    const env = await getEnv();
    const db = createDb(env.DB);

    const clientIP = getClientIP();
    const [, userResult] = await Promise.all([
      enforceRateLimit(env, `meeting:join:${clientIP}`),
      requireAuth().catch((err: unknown) => {
        if (err instanceof AppError && err.code === "UNAUTHORIZED") return null;
        throw err;
      }),
    ]);

    const user: Awaited<ReturnType<typeof requireAuth>> | null = userResult;
    const room = await db.query.rooms.findFirst({
      where: eq(rooms.code, data.code),
      with: { host: { columns: { plan: true } } },
    });

    if (!room || room.archivedAt) throw Errors.NOT_FOUND("Meeting");
    if (room.expiresAt && room.expiresAt < new Date()) {
      throw Errors.NOT_FOUND("Meeting room has expired");
    }

    let meeting = await db.query.meetingSessions.findFirst({
      where: and(eq(meetingSessions.roomId, room.id), eq(meetingSessions.status, "active")),
      with: { host: { columns: { plan: true } } },
    });
    let hostPlan = (meeting?.host?.plan as PlanType | undefined) ?? (room.host?.plan as PlanType | undefined) ?? "free";

    if (!meeting) {
      if (room.type !== "permanent" || !user || user.id !== room.hostId) {
        throw Errors.MEETING_NOT_STARTED();
      }

      hostPlan = (user.plan as PlanType) ?? "free";
      const limits = getPlanLimits(hostPlan);
      if (!limits.reusableMeetingLink) {
        throw Errors.FORBIDDEN("Your current plan no longer supports permanent meeting rooms. Please upgrade to reopen this room.");
      }

      const now = new Date();
      const sessionId = generateId("MEETING_SESSION");
      try {
        await withD1Retry(() =>
          db.batch([
            db.insert(meetingSessions).values({
              id: sessionId,
              roomId: room.id,
              publicSlug: createSessionSlug(now),
              title: room.title,
              hostId: room.hostId,
              spaceId: room.spaceId,
              allowGuests: room.allowGuests,
              recordingEnabled: room.recordingEnabled && limits.recordingEnabled,
              requireApproval: room.requireApproval,
              startedAt: now,
              updatedAt: now,
            }),
            db.update(rooms)
              .set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + ROOM_EXPIRY_MS), updatedAt: now })
              .where(eq(rooms.id, room.id)),
          ]),
        );
        meeting = await db.query.meetingSessions.findFirst({
          where: eq(meetingSessions.id, sessionId),
          with: { host: { columns: { plan: true } } },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("UNIQUE")) throw err;
        meeting = await db.query.meetingSessions.findFirst({
          where: and(eq(meetingSessions.roomId, room.id), eq(meetingSessions.status, "active")),
          with: { host: { columns: { plan: true } } },
        });
        if (!meeting) throw err;
      }
    }

    if (!meeting) throw Errors.NOT_FOUND("Meeting");

    if (room.type === "permanent") {
      const renewedAt = new Date();
      await withD1Retry(() =>
        db
          .update(rooms)
          .set({ lastUsedAt: renewedAt, expiresAt: new Date(renewedAt.getTime() + ROOM_EXPIRY_MS), updatedAt: renewedAt })
          .where(eq(rooms.id, room.id)),
      );
    }

    const issueMeetingAccessIfActive = async (args: Parameters<typeof issueMeetingAccess>[0]) => {
      const stillActive = await db.query.meetingSessions.findFirst({
        where: and(eq(meetingSessions.id, args.meeting.id), eq(meetingSessions.status, "active")),
        columns: { id: true },
      });
      if (!stillActive) throw Errors.NOT_FOUND("Meeting");
      return issueMeetingAccess(args);
    };

    if (meeting.spaceId && user) {
      await assertSpaceMembershipIfNeeded(db, meeting.spaceId, user.id);
    } else if (meeting.spaceId && !user) {
      throw Errors.UNAUTHORIZED();
    }

    const limits = await enforceMeetingDurationLimit(db, env, meeting, hostPlan);

    if (!meeting.allowGuests && !user) {
      throw Errors.UNAUTHORIZED();
    }

    const isHostJoining = user?.id === meeting.hostId;
    if (meeting.locked && !isHostJoining) {
      throw Errors.MEETING_LOCKED();
    }

    if (data.reconnectParticipantId) {
      if (user) {
        const existingParticipant = await db.query.meetingParticipants.findFirst({
          where: and(
            eq(meetingParticipants.sessionId, meeting.id),
            eq(meetingParticipants.id, data.reconnectParticipantId),
            eq(meetingParticipants.userId, user.id),
            inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
          ),
        });

        if (existingParticipant) {
          const participantRole = (existingParticipant.role as MeetingRole) ?? "participant";
          const isHost = existingParticipant.userId === meeting.hostId;
          const identity = existingParticipant.livekitIdentity ?? `${user.id}_${existingParticipant.id}`;

          return issueMeetingAccessIfActive({
            env,
            meeting,
            participantId: existingParticipant.id,
            participantIdentity: identity,
            participantName: existingParticipant.displayName,
            participantRole,
            isHost,
            recordingEnabled: meeting.recordingEnabled && limits.recordingEnabled,
          });
        }
      } else {
        const reconnectSecret = getGuestCookieSecret(data.reconnectParticipantId);
        const existingGuest = reconnectSecret
          ? await db.query.meetingParticipants.findFirst({
              where: and(
                eq(meetingParticipants.sessionId, meeting.id),
                eq(meetingParticipants.id, data.reconnectParticipantId),
                inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
                isNull(meetingParticipants.userId),
              ),
            })
          : null;
        if (existingGuest?.guestSecret && reconnectSecret) {
          if (await verifyGuestSecret(existingGuest.guestSecret, reconnectSecret)) {
            const identity = existingGuest.livekitIdentity ?? `guest_${existingGuest.id}`;
            setGuestCookie(existingGuest.id, reconnectSecret, {
              appUrl: env.APP_URL,
              environment: env.ENVIRONMENT,
            });
            return issueMeetingAccessIfActive({
              env,
              meeting,
              participantId: existingGuest.id,
              participantIdentity: identity,
              participantName: existingGuest.displayName,
              participantRole: "guest" as MeetingRole,
              isHost: false,
              recordingEnabled: meeting.recordingEnabled && limits.recordingEnabled,
            });
          }
        }
      }
    }

    const [participantCount] = await db
      .select({ count: count() })
      .from(meetingParticipants)
      .where(
        and(
          eq(meetingParticipants.sessionId, meeting.id),
          inArray(meetingParticipants.status, OCCUPYING_MEETING_PARTICIPANT_STATUSES),
        ),
      );

    if (limits.maxParticipants !== null && participantCount.count >= limits.maxParticipants) {
      throw Errors.PLAN_LIMIT_REACHED("Meeting is full");
    }

    const isHost = isHostJoining;
    const displayName = sanitizeDisplayName(user?.name ?? data.displayName ?? "Guest");
    const mpId = generateId("PARTICIPANT");
    const livekitIdentity = user ? `${user.id}_${mpId}` : `guest_${mpId}`;
    const guestSecretRaw = !user ? crypto.randomUUID() : null;
    const guestSecretHash = guestSecretRaw ? await hashSessionToken(guestSecretRaw) : null;
    const now = new Date();

    const activeAtInsertTime = await db.query.meetingSessions.findFirst({
      where: and(eq(meetingSessions.id, meeting.id), eq(meetingSessions.status, "active")),
      columns: { id: true },
    });
    if (!activeAtInsertTime) throw Errors.NOT_FOUND("Meeting");

    const needsApproval = meeting.requireApproval && !isHost;
    const initialStatus = needsApproval ? "awaiting_approval" : "pending";

    await withD1Retry(() =>
      db.insert(meetingParticipants).values({
        id: mpId,
        sessionId: meeting.id,
        userId: user?.id ?? null,
        displayName,
        role: isHost ? "host" : user ? "participant" : "guest",
        status: initialStatus,
        livekitIdentity,
        guestSecret: guestSecretHash,
        joinedAt: now,
      }),
    );

    if (needsApproval) {
      if (guestSecretRaw) {
        setGuestCookie(mpId, guestSecretRaw, {
          appUrl: env.APP_URL,
          environment: env.ENVIRONMENT,
        });
      }
      const awaiting = Errors.AWAITING_APPROVAL(mpId);
      (awaiting as AppError & { sessionId?: string; meetingId?: string }).sessionId = meeting.id;
      (awaiting as AppError & { sessionId?: string; meetingId?: string }).meetingId = meeting.id;
      throw awaiting;
    }

    const activeParticipants = await db
      .select({ id: meetingParticipants.id })
      .from(meetingParticipants)
      .where(
        and(
          eq(meetingParticipants.sessionId, meeting.id),
          inArray(meetingParticipants.status, OCCUPYING_MEETING_PARTICIPANT_STATUSES),
        ),
      )
      .orderBy(asc(meetingParticipants.joinedAt), asc(meetingParticipants.id));

    if (limits.maxParticipants !== null && activeParticipants.length > limits.maxParticipants) {
      const keepIds = new Set(activeParticipants.slice(0, limits.maxParticipants).map((p) => p.id));
      if (!keepIds.has(mpId)) {
        await withD1Retry(() => db.delete(meetingParticipants).where(eq(meetingParticipants.id, mpId)));
        throw Errors.PLAN_LIMIT_REACHED("Meeting is full");
      }
    }

    const participantRole: MeetingRole = isHost ? "host" : user ? "participant" : "guest";

    try {
      const access = await issueMeetingAccessIfActive({
        env,
        meeting,
        participantId: mpId,
        participantIdentity: livekitIdentity,
        participantName: displayName,
        participantRole,
        isHost,
        recordingEnabled: meeting.recordingEnabled && limits.recordingEnabled,
      });

      if (guestSecretRaw) {
        setGuestCookie(mpId, guestSecretRaw, {
          appUrl: env.APP_URL,
          environment: env.ENVIRONMENT,
        });
      }

      return access;
    } catch (err) {
      await withD1Retry(() => db.delete(meetingParticipants).where(eq(meetingParticipants.id, mpId))).catch(() => undefined);
      throw err;
    }
  });
