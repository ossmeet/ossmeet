import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";
import { meetingSessions, rooms, meetingParticipants } from "@ossmeet/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  CURRENT_MEETING_PARTICIPANT_STATUSES,
  refreshMeetingTokenSchema,
  Errors,
  AppError,
  ROOM_EXPIRY_MS,
} from "@ossmeet/shared";
import type { PlanType, MeetingRole } from "@ossmeet/shared";
import { verifyGuestSecret } from "@/lib/auth/crypto";
import { withD1Retry } from "@/lib/db-utils";
import { assertSpaceMembershipIfNeeded } from "./access-assertions";

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
      // Guest identity will be derived from participant row below
      identity = "";
      rateLimitKey = `token-refresh:guest:${data.participantId}`;
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

    const participant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.id, data.participantId),
        eq(meetingParticipants.sessionId, data.sessionId),
        inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES)
      ),
    });

    if (!participant) throw Errors.NOT_FOUND("Participant");

    // Verify caller owns this participant row
    if (isAuthenticated) {
      if (participant.userId !== identity) {
        throw Errors.FORBIDDEN();
      }
      // Re-check space membership on token refresh (revoked members must not refresh)
      await assertSpaceMembershipIfNeeded(db, meeting.spaceId, identity);
      // Use the stored LiveKit identity (unique per device) instead of raw user ID
      identity = participant.livekitIdentity ?? identity;
    } else {
      if (participant.userId !== null) {
        throw Errors.FORBIDDEN();
      }
      // Inline guest verification — participant already fetched above, so we
      // skip verifyGuestParticipant() to avoid a redundant DB round-trip.
      const guestCookieSecret = getGuestCookieSecret(data.participantId);
      if (!guestCookieSecret || !participant.guestSecret) {
        throw Errors.FORBIDDEN();
      }
      if (!await verifyGuestSecret(participant.guestSecret, guestCookieSecret)) {
        throw Errors.FORBIDDEN();
      }
      if (!participant.livekitIdentity) {
        throw Errors.VALIDATION("Guest participant missing LiveKit identity — cannot refresh token");
      }
      identity = participant.livekitIdentity;

      // Re-set the cookie so its 8h max-age slides forward. Without this, a
      // long meeting outlives the cookie and the guest gets kicked on the next
      // refresh with no recourse.
      setGuestCookie(data.participantId, guestCookieSecret, {
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

    const isHost = isAuthenticated && participant.userId === meeting.hostId;
    const displayName = participant.displayName ?? "Guest";
    const participantRole: MeetingRole = isHost
      ? "host"
      : (participant.role as MeetingRole);
    return issueMeetingAccess({
      env,
      meeting,
      participantId: participant.id,
      participantIdentity: identity,
      participantName: displayName,
      participantRole,
      isHost,
      recordingEnabled: meeting.recordingEnabled,
    });
  });
