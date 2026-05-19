import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";
import { meetingAdmissions, meetingLivekitPresences, meetingSessions, rooms, users } from "@ossmeet/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
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
import { isMeetingAtSoftCapacity } from "./presence-queries";
import { ensureMeetingAdmission, upsertMeetingLivekitPresence } from "./runtime-projection";
import { expireStaleAwaitingParticipants } from "./waiting-room";
import { createSessionSlug } from "@/lib/meeting/session-slug";

const AUTH_HELPERS_MODULE = "../auth/helpers";

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
    const initialRow = await db
      .select({
        room: {
          id: rooms.id,
          type: rooms.type,
          hostId: rooms.hostId,
          spaceId: rooms.spaceId,
          title: rooms.title,
          allowGuests: rooms.allowGuests,
          recordingEnabled: rooms.recordingEnabled,
          requireApproval: rooms.requireApproval,
          expiresAt: rooms.expiresAt,
          archivedAt: rooms.archivedAt,
        },
        host: {
          plan: users.plan,
        },
        meeting: {
          id: meetingSessions.id,
          title: meetingSessions.title,
          hostId: meetingSessions.hostId,
          spaceId: meetingSessions.spaceId,
          allowGuests: meetingSessions.allowGuests,
          recordingEnabled: meetingSessions.recordingEnabled,
          requireApproval: meetingSessions.requireApproval,
          locked: meetingSessions.locked,
          startedAt: meetingSessions.startedAt,
          activeEgressId: meetingSessions.activeEgressId,
          activeStreamEgressId: meetingSessions.activeStreamEgressId,
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

    const room = initialRow?.room;
    if (!room || room.archivedAt) throw Errors.NOT_FOUND("Meeting");
    if (room.expiresAt && room.expiresAt < new Date()) {
      throw Errors.NOT_FOUND("Meeting room has expired");
    }

    let meeting = initialRow?.meeting ?? null;
    let hostPlan = (initialRow?.host.plan as PlanType | undefined) ?? "free";

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
          columns: {
            id: true,
            title: true,
            hostId: true,
            spaceId: true,
            allowGuests: true,
            recordingEnabled: true,
            requireApproval: true,
            locked: true,
            startedAt: true,
            activeEgressId: true,
            activeStreamEgressId: true,
          },
        }) ?? null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("UNIQUE")) throw err;
        meeting = await db.query.meetingSessions.findFirst({
          where: and(eq(meetingSessions.roomId, room.id), eq(meetingSessions.status, "active")),
          columns: {
            id: true,
            title: true,
            hostId: true,
            spaceId: true,
            allowGuests: true,
            recordingEnabled: true,
            requireApproval: true,
            locked: true,
            startedAt: true,
            activeEgressId: true,
            activeStreamEgressId: true,
          },
        }) ?? null;
        if (!meeting) throw err;
      }
    }

    if (!meeting) throw Errors.NOT_FOUND("Meeting");

    if (meeting.spaceId && user) {
      await assertSpaceMembershipIfNeeded(db, meeting.spaceId, user.id);
    } else if (meeting.spaceId && !user) {
      throw Errors.UNAUTHORIZED();
    }

    const limits = await enforceMeetingDurationLimit(db, env, meeting, hostPlan);

    const { reclaimRoomHostIfReturning } = await import("./host-reclaim.server");
    const currentHostId = await reclaimRoomHostIfReturning(
      db,
      env,
      meeting.id,
      room.hostId,
      meeting.hostId,
      user?.id,
    );
    if (currentHostId !== meeting.hostId) {
      meeting = { ...meeting, hostId: currentHostId };
    }

    if (!meeting.allowGuests && !user) {
      throw Errors.UNAUTHORIZED();
    }

    const isHost = user?.id === meeting.hostId;
    if (meeting.locked && !isHost) {
      throw Errors.MEETING_LOCKED();
    }

    if (meeting.requireApproval) {
      await expireStaleAwaitingParticipants(db, meeting.id);
    }

    const issueMeetingAccessIfActive = async (args: Parameters<typeof issueMeetingAccess>[0]) => {
      const stillActive = await db.query.meetingSessions.findFirst({
        where: and(eq(meetingSessions.id, args.meeting.id), eq(meetingSessions.status, "active")),
        columns: { id: true },
      });
      if (!stillActive) throw Errors.NOT_FOUND("Meeting");
      return issueMeetingAccess(args);
    };

    const renewPermanentRoom = async () => {
      if (room.type !== "permanent") return;
      const renewedAt = new Date();
      await withD1Retry(() =>
        db
          .update(rooms)
          .set({ lastUsedAt: renewedAt, expiresAt: new Date(renewedAt.getTime() + ROOM_EXPIRY_MS), updatedAt: renewedAt })
          .where(eq(rooms.id, room.id)),
      );
    };

    const existingAdmission = data.reconnectAdmissionId
      ? await db.query.meetingAdmissions.findFirst({
          where: and(
            eq(meetingAdmissions.id, data.reconnectAdmissionId),
            eq(meetingAdmissions.sessionId, meeting.id),
            inArray(meetingAdmissions.admissionStatus, ["approved", "awaiting_approval"]),
          ),
        })
      : null;

    if (existingAdmission) {
      if (user) {
        if (existingAdmission.subjectUserId !== user.id) throw Errors.FORBIDDEN();
      } else {
        if (existingAdmission.subjectType !== "guest" || !existingAdmission.guestSecretHash) {
          throw Errors.FORBIDDEN();
        }
        const cookieSecret = getGuestCookieSecret(existingAdmission.id);
        if (!cookieSecret || !(await verifyGuestSecret(existingAdmission.guestSecretHash, cookieSecret))) {
          throw Errors.FORBIDDEN();
        }
        setGuestCookie(existingAdmission.id, cookieSecret, {
          appUrl: env.APP_URL,
          environment: env.ENVIRONMENT,
        });
      }

      if (existingAdmission.admissionStatus === "awaiting_approval") {
        const awaiting = Errors.AWAITING_APPROVAL(existingAdmission.id);
        (awaiting as AppError & { sessionId?: string; meetingId?: string }).sessionId = meeting.id;
        (awaiting as AppError & { sessionId?: string; meetingId?: string }).meetingId = meeting.id;
        throw awaiting;
      }

      const connection = await db.query.meetingLivekitPresences.findFirst({
        where: and(
          eq(meetingLivekitPresences.sessionId, meeting.id),
          eq(meetingLivekitPresences.admissionId, existingAdmission.id),
          inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued", "disconnected", "aborted"]),
        ),
        orderBy: (connections, { desc }) => [desc(connections.updatedAt)],
      });
      const livekitIdentity =
        connection?.livekitIdentity ??
        (user ? `${user.id}_${existingAdmission.id}` : `guest_${existingAdmission.id}`);
      const participantRole: MeetingRole = connection?.role === "host"
        ? "host"
        : isHost
        ? "host"
        : existingAdmission.subjectUserId
          ? "participant"
          : "guest";
      const isActingModerator = connection?.role === "host" && !isHost;
      const connectionId = await upsertMeetingLivekitPresence(db, {
        sessionId: meeting.id,
        admissionId: existingAdmission.id,
        livekitIdentity,
        userId: existingAdmission.subjectUserId,
        role: participantRole,
        presenceStatus: "token_issued",
      });

      await renewPermanentRoom();
      return issueMeetingAccessIfActive({
        env,
        meeting,
        connectionId,
        admissionId: existingAdmission.id,
        participantIdentity: livekitIdentity,
        participantName: existingAdmission.displayName,
        participantRole,
        isHost,
        isActingModerator,
        recordingEnabled: meeting.recordingEnabled && limits.recordingEnabled,
      });
    }

    if (await isMeetingAtSoftCapacity(db, meeting.id, limits.maxParticipants)) {
      throw Errors.PLAN_LIMIT_REACHED("Meeting is full");
    }

    const now = new Date();
    const admissionId = generateId("MEETING_ADMISSION");
    const displayName = sanitizeDisplayName(user?.name ?? data.displayName ?? "Guest");
    const participantRole: MeetingRole = isHost ? "host" : user ? "participant" : "guest";
    const livekitIdentity = user ? `${user.id}_${admissionId}` : `guest_${admissionId}`;
    const guestSecretHashRaw = !user ? crypto.randomUUID() : null;
    const guestSecretHashHash = guestSecretHashRaw ? await hashSessionToken(guestSecretHashRaw) : null;
    const needsApproval = meeting.requireApproval && !isHost;

    await ensureMeetingAdmission(db, {
      id: admissionId,
      sessionId: meeting.id,
      subjectType: user ? "user" : "guest",
      subjectUserId: user?.id ?? null,
      guestSecretHash: guestSecretHashHash,
      displayName,
      requestedRole: participantRole,
      admissionStatus: needsApproval ? "awaiting_approval" : "approved",
      decidedAt: needsApproval ? null : now,
      decidedByUserId: needsApproval ? null : user?.id ?? null,
    });

    if (guestSecretHashRaw) {
      setGuestCookie(admissionId, guestSecretHashRaw, {
        appUrl: env.APP_URL,
        environment: env.ENVIRONMENT,
      });
    }

    if (needsApproval) {
      const awaiting = Errors.AWAITING_APPROVAL(admissionId);
      (awaiting as AppError & { sessionId?: string; meetingId?: string }).sessionId = meeting.id;
      (awaiting as AppError & { sessionId?: string; meetingId?: string }).meetingId = meeting.id;
      throw awaiting;
    }

    await renewPermanentRoom();
    const connectionId = await upsertMeetingLivekitPresence(db, {
      sessionId: meeting.id,
      admissionId,
      livekitIdentity,
      userId: user?.id ?? null,
      role: participantRole,
      presenceStatus: "token_issued",
    });

    try {
      return await issueMeetingAccessIfActive({
        env,
        meeting,
        connectionId,
        admissionId: admissionId,
        participantIdentity: livekitIdentity,
        participantName: displayName,
        participantRole,
        isHost,
        isActingModerator: false,
        recordingEnabled: meeting.recordingEnabled && limits.recordingEnabled,
      });
    } catch (err) {
      await Promise.all([
        withD1Retry(() => db.delete(meetingLivekitPresences).where(eq(meetingLivekitPresences.id, connectionId))).catch(() => undefined),
        withD1Retry(() => db.delete(meetingAdmissions).where(eq(meetingAdmissions.id, admissionId))).catch(() => undefined),
      ]);
      throw err;
    }
  });
