import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";
import { meetingLivekitPresences, meetingSessions } from "@ossmeet/db/schema";
import { eq, and } from "drizzle-orm";
import {
  leaveMeetingSchema,
  endMeetingSchema,
  Errors,
  AppError,
} from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { clearWhiteboardMeetingCookies } from "@whiteboard/server";
export { livekitHttpUrl };

const AUTH_HELPERS_MODULE = "../auth/helpers";

/**
 * Mark a participant as left.
 *
 * No app-side decision about ending the meeting is made here. LiveKit's
 * `departure_timeout` owns the "is the room actually empty?" question
 * (see `tearDownLiveKitRoom` and the `room_finished` webhook handler).
 */
export const leaveMeeting = createServerFn({ method: "POST" })
  .inputValidator(leaveMeetingSchema)
  .handler(async ({ data }) => {
    const {
      getEnv,
      requireAuth,
      getGuestCookieSecret,
      getClientIP,
      clearGuestCookie,
    } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    const env = await getEnv();
    const db = createDb(env.DB);

    let userId: string | null = null;
    try {
      const user = await requireAuth();
      userId = user.id;
    } catch (err) {
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;
    }
    const connection = await db.query.meetingLivekitPresences.findFirst({
      where: and(
        eq(meetingLivekitPresences.id, data.connectionId),
        eq(meetingLivekitPresences.sessionId, data.sessionId),
      ),
      columns: { admissionId: true },
    });

    const { executeLeaveMeeting } = await import("./leave-end.server");
    const result = await executeLeaveMeeting({
      env,
      db,
      meetingId: data.sessionId,
      connectionId: data.connectionId,
      authenticatedUserId: userId,
      guestCookieSecret: connection?.admissionId
        ? getGuestCookieSecret(connection.admissionId)
        : null,
      rateLimitKey: userId ? `meeting:leave:${userId}` : `meeting:leave:${getClientIP()}`,
      onGuestLeft: (admissionId) => {
        clearGuestCookie(admissionId, {
          appUrl: env.APP_URL,
          environment: env.ENVIRONMENT,
        });
      },
    });

    if (result.found) {
      clearWhiteboardMeetingCookies?.(env, data.sessionId);
    }

    return result;
  });

/**
 * End a meeting (host only).
 *
 * Single canonical end path: `endSession` writes `status=ended` (idempotent
 * CAS), runs post-meeting tasks (transcript archive, whiteboard
 * `/session-end`), then tears down the LiveKit room — which forcibly
 * disconnects every participant.
 *
 * The `room_finished` webhook will arrive shortly after; its handler
 * calls `finalizeSession` again but the CAS is a no-op since we already
 * transitioned the row.
 */
export const endMeeting = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(endMeetingSchema)
  .handler(async ({ data, context: { user, env, db } }) => {
    const { enforceRateLimit, getCloudflareCtx } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    await enforceRateLimit(env, `meeting:end:${user.id}`);

    const meeting = await db.query.meetingSessions.findFirst({
      where: and(
        eq(meetingSessions.id, data.sessionId),
        eq(meetingSessions.status, "active"),
      ),
    });

    if (!meeting) throw Errors.NOT_FOUND("Meeting");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    const { endSession } = await import("./leave-end.server");
    const ctx = getCloudflareCtx();
    await endSession(db, env, meeting.id, "host", ctx);

    clearWhiteboardMeetingCookies?.(env, meeting.id);

    return { success: true };
  });
