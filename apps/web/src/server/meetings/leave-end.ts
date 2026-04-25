import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";
import { meetingSessions } from "@ossmeet/db/schema";
import { eq, and } from "drizzle-orm";
import {
  leaveMeetingSchema,
  endMeetingSchema,
  Errors,
  AppError,
} from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { finalizeSessionByMeetingId } from "./session-finalizer";
export { livekitHttpUrl };

const AUTH_HELPERS_MODULE = "../auth/helpers";

/**
 * Mark a participant as left
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
    const { executeLeaveMeeting } = await import("./leave-end.server");
    return executeLeaveMeeting({
      env,
      db,
      meetingId: data.sessionId,
      participantId: data.participantId,
      authenticatedUserId: userId,
      guestCookieSecret: data.participantId ? getGuestCookieSecret(data.participantId) : null,
      rateLimitKey: userId ? `meeting:leave:${userId}` : `meeting:leave:${getClientIP()}`,
      onGuestLeft: (participantId) => {
        clearGuestCookie(participantId, {
          appUrl: env.APP_URL,
          environment: env.ENVIRONMENT,
        });
      },
    });
  });

/**
 * End a meeting (host only)
 */
export const endMeeting = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(endMeetingSchema)
  .handler(async ({ data, context: { user, env, db } }) => {
    const { enforceRateLimit } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    await enforceRateLimit(env, `meeting:end:${user.id}`);

    const meeting = await db.query.meetingSessions.findFirst({
      where: and(
        eq(meetingSessions.id, data.sessionId),
        eq(meetingSessions.status, "active"),
      ),
    });

    if (!meeting) throw Errors.NOT_FOUND("Meeting");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    await finalizeSessionByMeetingId(db, {
      meetingId: meeting.id,
      now: new Date(),
      onlyActive: true,
      env,
    });

    const { terminateMeetingRoom } = await import("./leave-end.server");
    await terminateMeetingRoom(env, meeting.id, meeting.activeEgressId);

    return { success: true };
  });
