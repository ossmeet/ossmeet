import { createServerFn } from "@tanstack/react-start";
import { meetingSessions } from "@ossmeet/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { toggleStreamingSchema, Errors } from "@ossmeet/shared";
import { z } from "zod";
import { getRunChanges } from "@/lib/db-utils";
import { authMiddleware } from "../middleware";
import { startStreamingTask, stopStreamingTask } from "./streaming-tasks.server";

const getStreamingStatusSchema = z.object({
  sessionId: z.string().min(1),
});

const fullRtmpUrlPlatforms = new Set(["linkedin", "instagram", "tiktok", "x", "custom"]);

export const getStreamingStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(getStreamingStatusSchema)
  .handler(async ({ data, context: { user, db } }) => {
    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, data.sessionId),
      columns: { hostId: true, status: true, activeStreamEgressId: true },
    });
    if (!meeting) throw Errors.NOT_FOUND("Meeting not found");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    if (meeting.status !== "active" || !meeting.activeStreamEgressId) {
      return { status: "stopped" as const, egressId: null, pending: false };
    }
    if (meeting.activeStreamEgressId.startsWith("__starting__:")) {
      return { status: "pending" as const, egressId: null, pending: true };
    }
    return { status: "streaming" as const, egressId: meeting.activeStreamEgressId, pending: false };
  });

export const toggleStreaming = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(toggleStreamingSchema)
  .handler(async ({ data, context: { user, env, db } }) => {
    const meeting = await db.query.meetingSessions.findFirst({
      where: and(eq(meetingSessions.id, data.sessionId), eq(meetingSessions.status, "active")),
    });
    if (!meeting) throw Errors.NOT_FOUND("Meeting not found");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    if (data.action === "start") {
      if (meeting.activeStreamEgressId) {
        if (meeting.activeStreamEgressId.startsWith("__starting__:")) {
          throw Errors.VALIDATION("Stream is already starting");
        }
        throw Errors.VALIDATION("Stream is already active");
      }
      if (meeting.activeEgressId) {
        throw Errors.VALIDATION("Cannot stream while recording is active");
      }
      if (!data.platform || !data.streamKey) {
        throw Errors.VALIDATION("Platform and stream key are required");
      }
      if (fullRtmpUrlPlatforms.has(data.platform) && !/^rtmps?:\/\/\S+$/i.test(data.streamKey.trim())) {
        throw Errors.VALIDATION("This destination requires a full RTMP or RTMPS URL");
      }

      const sentinel = `__starting__:${crypto.randomUUID()}`;
      const casResult = await db
        .update(meetingSessions)
        .set({ activeStreamEgressId: sentinel, updatedAt: new Date() })
        .where(
          and(
            eq(meetingSessions.id, meeting.id),
            isNull(meetingSessions.activeStreamEgressId),
            isNull(meetingSessions.activeEgressId),
            eq(meetingSessions.status, "active"),
          )
        )
        .run();
      const changes = getRunChanges(casResult);
      if (changes === 0) {
        throw Errors.VALIDATION("Stream is already starting or a recording is active");
      }

      let started: Awaited<ReturnType<typeof startStreamingTask>>;
      try {
        started = await startStreamingTask(env, meeting.id, sentinel, data.platform, data.streamKey);
      } catch (err) {
        await db
          .update(meetingSessions)
          .set({ activeStreamEgressId: null, updatedAt: new Date() })
          .where(and(eq(meetingSessions.id, meeting.id), eq(meetingSessions.activeStreamEgressId, sentinel)))
          .run()
          .catch(() => undefined);
        throw err;
      }
      if (!started || "error" in started) {
        throw Errors.VALIDATION(started?.error ?? "Stream could not be started");
      }
      return { egressId: started.egressId, status: "streaming" as const };
    }

    if (data.action === "stop") {
      const storedEgressId = meeting.activeStreamEgressId;
      if (!storedEgressId) {
        throw Errors.VALIDATION("No active stream found");
      }
      if (storedEgressId.startsWith("__starting__:")) {
        throw Errors.VALIDATION("Stream is still starting, please try again");
      }
      if (data.egressId && data.egressId !== storedEgressId) {
        throw Errors.VALIDATION("Egress ID mismatch");
      }

      await stopStreamingTask(env, meeting.id, storedEgressId);
      return { egressId: null, status: "stopped" as const };
    }

    throw Errors.VALIDATION("Invalid streaming action");
  });
