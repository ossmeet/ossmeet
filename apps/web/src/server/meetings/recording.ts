import { createServerFn } from "@tanstack/react-start";
import { meetingSessions } from "@ossmeet/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { toggleRecordingSchema, Errors, getPlanLimits } from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { z } from "zod";
import { authMiddleware } from "../middleware";
import { startRecordingTask, stopRecordingTask } from "./recording-tasks.server";

const getRecordingStatusSchema = z.object({
  sessionId: z.string().min(1),
});

export const getRecordingStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(getRecordingStatusSchema)
  .handler(async ({ data, context: { user, db } }) => {
    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, data.sessionId),
      columns: { hostId: true, status: true, activeEgressId: true },
    });
    if (!meeting) throw Errors.NOT_FOUND("Meeting not found");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    if (meeting.status !== "active" || !meeting.activeEgressId) {
      return { status: "stopped" as const, egressId: null, pending: false };
    }
    if (meeting.activeEgressId.startsWith("__starting__:")) {
      return { status: "pending" as const, egressId: null, pending: true };
    }
    return { status: "recording" as const, egressId: meeting.activeEgressId, pending: false };
  });

export const toggleRecording = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(toggleRecordingSchema)
  .handler(async ({ data, context: { user, env, db } }) => {
    const meeting = await db.query.meetingSessions.findFirst({
      where: and(eq(meetingSessions.id, data.sessionId), eq(meetingSessions.status, "active")),
    });
    if (!meeting) throw Errors.NOT_FOUND("Meeting not found");
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    const limits = getPlanLimits(user.plan as PlanType);
    if (!limits.recordingEnabled) {
      throw Errors.PLAN_LIMIT_REACHED("Recording is not available on your plan");
    }
    if (!meeting.recordingEnabled) {
      throw Errors.FORBIDDEN();
    }

    if (data.action === "start") {
      if (meeting.activeEgressId) {
        if (meeting.activeEgressId.startsWith("__starting__:")) {
          throw Errors.VALIDATION("Recording is already starting");
        }
        throw Errors.VALIDATION("Recording is already active");
      }

      const sentinel = `__starting__:${crypto.randomUUID()}`;
      const casResult = await db
        .update(meetingSessions)
        .set({ activeEgressId: sentinel, updatedAt: new Date() })
        .where(and(eq(meetingSessions.id, meeting.id), isNull(meetingSessions.activeEgressId), eq(meetingSessions.status, "active")))
        .run();
      const changes = (casResult as { meta?: { changes?: number } }).meta?.changes ?? 0;
      if (changes === 0) {
        throw Errors.VALIDATION("Recording is already starting or active");
      }

      const started = await startRecordingTask(env, meeting.id, sentinel);
      if (!started?.egressId) {
        throw Errors.VALIDATION("Recording could not be started");
      }
      return { egressId: started.egressId, status: "recording" as const };
    }

    if (data.action === "stop") {
      const storedEgressId = meeting.activeEgressId;
      if (!storedEgressId) {
        throw Errors.VALIDATION("No active recording found");
      }
      if (storedEgressId.startsWith("__starting__:")) {
        throw Errors.VALIDATION("Recording is still starting, please try again");
      }
      if (data.egressId && data.egressId !== storedEgressId) {
        throw Errors.VALIDATION("Egress ID mismatch");
      }

      await stopRecordingTask(env, meeting.id, storedEgressId);
      return { egressId: null, status: "stopped" as const };
    }

    throw Errors.VALIDATION("Invalid recording action");
  });
