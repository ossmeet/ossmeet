import type { Database } from "@ossmeet/db";
import { meetingSessions, users } from "@ossmeet/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  chunkArray,
  d1MaxItemsPerStatement,
  type PlanType,
} from "@ossmeet/shared";
import { finalizeMeetingEnd } from "./finalize";
import { generateMeetingNotesForSession } from "@/server/transcripts/generate-notes";
import { appendMeetingEvent } from "./runtime-projection";
import { logError } from "@/lib/logger";
import { notifyWhiteboardMeetingFinalized } from "@whiteboard/server";

/**
 * Why a session ended. Recorded as a `meetingEvent` for auditability and
 * helps us reason about which path drove the finalization.
 *
 * - `host`    — host explicitly clicked "End for everyone".
 * - `natural` — LiveKit `room_finished` after `departure_timeout` elapsed
 *               with nobody back. The room is already gone in LiveKit.
 * - `system`  — app-level forced end (account deletion, space deletion,
 *               plan duration cap, concurrent-meeting cap, etc.).
 * - `stale`   — background reconciler found a session whose LiveKit room
 *               disappeared without us seeing the `room_finished` webhook.
 */
export type SessionEndReason = "host" | "natural" | "system" | "stale";

export interface FinalizedSessionInfo {
  meetingId: string;
  activeEgressId: string | null;
  activeStreamEgressId: string | null;
}

export type PostMeetingTasksEnv = Env;

interface FinalizeSessionInput {
  meetingId: string;
  reason: SessionEndReason;
  now?: Date;
  onlyActive?: boolean;
  env?: PostMeetingTasksEnv;
}

interface FinalizeSessionsInput {
  meetingIds: string[];
  reason: SessionEndReason;
  now?: Date;
  onlyActive?: boolean;
  env?: PostMeetingTasksEnv;
}

const SESSION_LOOKUP_CHUNK_SIZE = d1MaxItemsPerStatement(1, 1);

function normalizeMeetingIds(meetingIds: string[]): string[] {
  return Array.from(new Set(meetingIds.filter(Boolean)));
}

/**
 * Side effects that fire exactly once when a session transitions
 * active → ended. Individual failures are logged but never thrown,
 * so one slow/dead service can't take down the others.
 *
 * Callers on Cloudflare Workers should pass this to ctx.waitUntil()
 * so it runs after the response is sent and does not block the client.
 */
export async function runPostMeetingTasks(
  db: Database,
  env: PostMeetingTasksEnv,
  meetingId: string,
  reason: SessionEndReason,
): Promise<void> {
  await Promise.allSettled([
    appendMeetingEvent(db, {
      sessionId: meetingId,
      kind: `session.ended.${reason}`,
      subjectId: meetingId,
      payload: { reason },
    }).catch((err) => {
      logError(`[finalizeSession] Audit event write failed for ${meetingId}:`, err);
    }),

    // Best-effort AI summary. The recap page also has its own retry-on-view
    // path, so a transient LLM failure here isn't fatal.
    generateMeetingNotesForSession(db, env, meetingId).catch((err) => {
      logError(`[finalizeSession] Summary generation failed for ${meetingId}:`, err);
    }),

    notifyWhiteboardMeetingFinalized?.(env, meetingId).catch((err) => {
      logError(`[finalizeSession] Whiteboard finalization failed for ${meetingId}:`, err);
    }),
  ]);
}

/**
 * Idempotent CAS to `status=ended` for a single session, plus
 * post-meeting side effects. Returns null if the session was already
 * ended or doesn't exist.
 *
 * Callers that need to also delete the LiveKit room should use
 * `endSession` (in `leave-end.server.ts`) rather than calling this
 * directly — it composes finalize + LiveKit teardown in the right order.
 */
export async function finalizeSession(
  db: Database,
  { meetingId, reason, now = new Date(), onlyActive = true, env }: FinalizeSessionInput,
): Promise<FinalizedSessionInfo | null> {
  const meeting = await db.query.meetingSessions.findFirst({
    where: eq(meetingSessions.id, meetingId),
    columns: { id: true, hostId: true, status: true, activeEgressId: true, activeStreamEgressId: true },
  });
  if (!meeting) return null;
  if (onlyActive && meeting.status !== "active") return null;

  const host = await db.query.users.findFirst({
    where: eq(users.id, meeting.hostId),
    columns: { plan: true },
  });

  const finalized = await finalizeMeetingEnd(db, {
    meetingId: meeting.id,
    hostPlan: (host?.plan as PlanType) ?? "free",
    now,
    onlyActive,
  });
  if (!finalized) return null;

  if (env) {
    await runPostMeetingTasks(db, env, meeting.id, reason);
  }

  return {
    meetingId: meeting.id,
    activeEgressId: meeting.activeEgressId,
    activeStreamEgressId: meeting.activeStreamEgressId,
  };
}

/**
 * Batch variant of `finalizeSession`. Returns the IDs of sessions that
 * were transitioned to `ended` by this call (i.e. excludes already-ended
 * or missing rows).
 */
export async function finalizeSessions(
  db: Database,
  { meetingIds, reason, now = new Date(), onlyActive = true, env }: FinalizeSessionsInput,
): Promise<string[]> {
  const ids = normalizeMeetingIds(meetingIds);
  if (ids.length === 0) return [];

  const rows: Array<{ id: string; hostPlan: PlanType }> = [];
  const chunkSize = onlyActive ? SESSION_LOOKUP_CHUNK_SIZE : d1MaxItemsPerStatement();
  for (const chunk of chunkArray(ids, chunkSize)) {
    rows.push(
      ...(await db
        .select({
          id: meetingSessions.id,
          hostPlan: users.plan,
        })
        .from(meetingSessions)
        .innerJoin(users, eq(users.id, meetingSessions.hostId))
        .where(
          onlyActive
            ? and(inArray(meetingSessions.id, chunk), eq(meetingSessions.status, "active"))
            : inArray(meetingSessions.id, chunk),
        )),
    );
  }

  if (rows.length === 0) return [];

  const hostPlanByMeetingId = new Map<string, PlanType>();
  for (const row of rows) {
    hostPlanByMeetingId.set(row.id, (row.hostPlan as PlanType) ?? "free");
  }

  const finalizedIds: string[] = [];
  for (const row of rows) {
    const finalized = await finalizeMeetingEnd(db, {
      meetingId: row.id,
      hostPlan: hostPlanByMeetingId.get(row.id) ?? "free",
      now,
      onlyActive,
    });
    if (finalized) finalizedIds.push(row.id);
  }

  if (env) {
    await Promise.allSettled(
      finalizedIds.map((meetingId) => runPostMeetingTasks(db, env, meetingId, reason)),
    );
  }

  return finalizedIds;
}
