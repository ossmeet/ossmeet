import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";
import { meetingAdmissions, meetingSessions, rooms, meetingLivekitPresences } from "@ossmeet/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  refreshMeetingTokenSchema,
  Errors,
  AppError,
  ROOM_EXPIRY_MS,
  getPlanLimits,
} from "@ossmeet/shared";
import type { PlanType, MeetingRole } from "@ossmeet/shared";
import { verifyGuestSecret } from "@/lib/auth/crypto";
import { withD1Retry } from "@/lib/db-utils";
import { assertSpaceMembershipIfNeeded } from "./access-assertions";
import { upsertMeetingLivekitPresence } from "./runtime-projection";

const AUTH_HELPERS_MODULE = "../auth/helpers";

/**
 * Refresh a meeting token without creating a duplicate participant row
 */
export const refreshMeetingToken = createServerFn({ method: "POST" })
  .inputValidator(refreshMeetingTokenSchema)
  .handler(async ({ data }) => {
    const { enforceMeetingDurationLimit, issueMeetingAccess } = await import("./access.server");
    const {
      getEnv,
      requireAuth,
      getClientIP,
      enforceRateLimit,
      getGuestCookieSecret,
      setGuestCookie,
    } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    const env = await getEnv();
    const db = createDb(env.DB);

    let identity: string;
    let isAuthenticated = false;
    let rateLimitKey = `token-refresh:${getClientIP()}`;
    try {
      const user = await requireAuth();
      identity = user.id;
      isAuthenticated = true;
      rateLimitKey = `token-refresh:user:${user.id}`;
    } catch (err) {
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) {
        throw err;
      }
      // Guest identity will be derived from the connection row below.
      identity = "";
      rateLimitKey = `token-refresh:guest:${data.connectionId}`;
    }

    await enforceRateLimit(env, rateLimitKey);

    const meeting = await db.query.meetingSessions.findFirst({
      where: and(
        eq(meetingSessions.id, data.sessionId),
        eq(meetingSessions.status, "active")
      ),
      with: { host: { columns: { plan: true } } },
    });

    if (!meeting) throw Errors.NOT_FOUND("Meeting");

    await enforceMeetingDurationLimit(db, env, meeting, (meeting.host?.plan as PlanType) ?? "free");

    const connection = await db.query.meetingLivekitPresences.findFirst({
      where: and(
        eq(meetingLivekitPresences.id, data.connectionId),
        eq(meetingLivekitPresences.sessionId, data.sessionId),
        inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued"]),
      ),
      columns: {
        id: true,
        admissionId: true,
        livekitIdentity: true,
        userId: true,
        role: true,
        presenceStatus: true,
      },
    });

    if (!connection) throw Errors.NOT_FOUND("Connection");

    const admission = await db.query.meetingAdmissions.findFirst({
      where: and(
        eq(meetingAdmissions.id, connection.admissionId),
        eq(meetingAdmissions.sessionId, data.sessionId),
        eq(meetingAdmissions.admissionStatus, "approved"),
      ),
      columns: {
        id: true,
        displayName: true,
        guestSecretHash: true,
      },
    });
    if (!admission) throw Errors.FORBIDDEN();

    // Verify caller owns this admission.
    if (isAuthenticated) {
      if (connection.userId !== identity) {
        throw Errors.FORBIDDEN();
      }
      // Re-check space membership on token refresh (revoked members must not refresh)
      await assertSpaceMembershipIfNeeded(db, meeting.spaceId, identity);
      // Use the stored LiveKit identity (unique per device) instead of raw user ID
      identity = connection.livekitIdentity ?? identity;
    } else {
      if (connection.userId !== null) {
        throw Errors.FORBIDDEN();
      }
      if (!admission.guestSecretHash) throw Errors.FORBIDDEN();
      const guestCookieSecret = getGuestCookieSecret(admission.id);
      if (!guestCookieSecret) throw Errors.FORBIDDEN();
      if (!await verifyGuestSecret(admission.guestSecretHash, guestCookieSecret)) {
        throw Errors.FORBIDDEN();
      }
      if (!connection.livekitIdentity) {
        throw Errors.VALIDATION("Guest participant missing LiveKit identity — cannot refresh token");
      }
      identity = connection.livekitIdentity;

      // Re-set the cookie so its 8h max-age slides forward. Without this, a
      // long meeting outlives the cookie and the guest gets kicked on the next
      // refresh with no recourse.
      setGuestCookie(admission.id, guestCookieSecret, {
        appUrl: env.APP_URL,
        environment: env.ENVIRONMENT,
      });
    }

    const renewedAt = new Date();
    await withD1Retry(() =>
      db
        .update(rooms)
        .set({
          lastUsedAt: renewedAt,
          expiresAt: new Date(renewedAt.getTime() + ROOM_EXPIRY_MS),
          updatedAt: renewedAt,
        })
        .where(and(eq(rooms.id, meeting.roomId), eq(rooms.type, "permanent")))
    ).catch(() => {
      // Non-critical: room expiry extension failure doesn't block token refresh.
      // Permanent rooms may expire earlier than expected if this consistently fails.
    });

    const isHost = isAuthenticated && connection.userId === meeting.hostId;
    const displayName = admission.displayName;
    const participantRole: MeetingRole = connection.role === "host"
      ? "host"
      : isHost
        ? "host"
        : connection.userId
          ? "participant"
          : "guest";
    const isActingModerator = connection.role === "host" && !isHost;
    const limits = getPlanLimits((meeting.host?.plan as PlanType) ?? "free");
    const connectionId = await upsertMeetingLivekitPresence(db, {
      sessionId: meeting.id,
      admissionId: admission.id,
      livekitIdentity: identity,
      userId: connection.userId,
      role: participantRole,
      // The projection helper preserves `connected` rows on refresh. A token
      // refresh should extend credentials, not move a live participant back to
      // the pre-join state.
      presenceStatus: "token_issued",
    });
    return issueMeetingAccess({
      env,
      meeting,
      connectionId,
      admissionId: admission.id,
      participantIdentity: identity,
      participantName: displayName,
      participantRole,
      isHost,
      isActingModerator,
      recordingEnabled: meeting.recordingEnabled && limits.recordingEnabled,
    });
  });
