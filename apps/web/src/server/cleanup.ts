import { createDb } from "@ossmeet/db";
import {
  sessions,
  devices,
  verifications,
  spaceInvites,
  meetingArtifacts,
  meetingSessions,
  rooms,
  users,
} from "@ossmeet/db/schema";
import { lt, and, eq, isNotNull, or, inArray } from "drizzle-orm";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { chunkArray } from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { terminateMeetingRoom } from "./meetings/leave-end";
import { archiveMeetingTranscriptsToR2 } from "./transcripts/archive";
import { finalizeMeetingsEndByHostPlan } from "./meetings/finalize";
import { registerMeetingArtifactMetadata } from "./assets/register";

// Rows to delete per batch iteration. Keep below D1's 100-parameter ceiling so
// callers can add small predicates to follow-up queries.
const BATCH_LIMIT = 90;
// Separate limit for zombies: each triggers external LiveKit API calls.
const ZOMBIE_BATCH_LIMIT = 50;
// Meetings stuck in "active" longer than this are considered zombies.
const ZOMBIE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
// Max batch iterations per cleanup run — prevents runaway loops on large backlogs.
const MAX_BATCH_ITERATIONS = 10;
// Max R2 list pages for reconciliation (100 objects/page = 2000 objects max).
const MAX_R2_PAGES = 20;

const CRON_FREQUENT = "*/5 * * * *";
const CRON_DAILY = "0 2 * * *";

/**
 * Entry point for the Worker's `scheduled` handler.
 * cron "* /5 * * * *" → lightweight session/verification cleanup
 * cron "0 2 * * *"    → full daily maintenance
 */
export async function runCleanup(cron: string, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date();

  if (cron === CRON_FREQUENT) {
    await cleanupExpiredSessions(db, now);
    await cleanupExpiredDevices(db, now);
    await cleanupExpiredVerifications(db, now);
    return;
  }

  if (cron === CRON_DAILY) {
    await cleanupExpiredSessions(db, now);
    await cleanupExpiredDevices(db, now);
    await cleanupExpiredVerifications(db, now);
    await cleanupExpiredInvites(db, now);
    await cleanupZombieMeetings(db, env, now);
    await cleanupExpiredMeetings(db, now);
    await cleanupStaleLinks(db, now);
    await reconcileOrphanedRecordings(db, env, now);
    return;
  }

  logWarn(`[cleanup] Unrecognized cron expression: ${cron}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Repeatedly deletes rows in batches until there are no more matches.
 * Guards against permanent backlog by capping at MAX_BATCH_ITERATIONS runs.
 */
async function deleteInBatches(
  label: string,
  fetchBatch: () => Promise<{ id: string }[]>,
  removeBatch: (ids: string[]) => Promise<unknown>,
): Promise<void> {
  let total = 0;
  for (let i = 0; i < MAX_BATCH_ITERATIONS; i++) {
    const batch = await fetchBatch();
    if (batch.length === 0) break;
    await removeBatch(batch.map((r) => r.id));
    total += batch.length;
    if (batch.length < BATCH_LIMIT) break;
  }
  if (total > 0) logInfo(`[cleanup] Deleted ${total} ${label}`);
}

// ─── Cleanup functions ────────────────────────────────────────────────────────

async function cleanupExpiredSessions(db: ReturnType<typeof createDb>, now: Date): Promise<void> {
  try {
    await deleteInBatches(
      "expired sessions",
      () =>
        db
          .select({ id: sessions.id })
          .from(sessions)
          .where(or(lt(sessions.expiresAt, now), lt(sessions.absoluteExpiresAt, now)))
          .limit(BATCH_LIMIT),
      (ids) => db.delete(sessions).where(inArray(sessions.id, ids)),
    );
  } catch (err) {
    logError("[cleanup] Failed to delete expired sessions:", err);
  }
}

async function cleanupExpiredDevices(db: ReturnType<typeof createDb>, now: Date): Promise<void> {
  try {
    await deleteInBatches(
      "expired devices",
      () =>
        db
          .select({ id: devices.id })
          .from(devices)
          .where(lt(devices.expiresAt, now))
          .limit(BATCH_LIMIT),
      (ids) => db.delete(devices).where(inArray(devices.id, ids)),
    );
  } catch (err) {
    logError("[cleanup] Failed to delete expired devices:", err);
  }
}

async function cleanupExpiredVerifications(
  db: ReturnType<typeof createDb>,
  now: Date,
): Promise<void> {
  try {
    await deleteInBatches(
      "expired verifications",
      () =>
        db
          .select({ id: verifications.id })
          .from(verifications)
          .where(lt(verifications.expiresAt, now))
          .limit(BATCH_LIMIT),
      (ids) => db.delete(verifications).where(inArray(verifications.id, ids)),
    );
  } catch (err) {
    logError("[cleanup] Failed to delete expired verifications:", err);
  }
}

async function cleanupExpiredInvites(db: ReturnType<typeof createDb>, now: Date): Promise<void> {
  try {
    await deleteInBatches(
      "expired space invites",
      () =>
        db
          .select({ id: spaceInvites.id })
          .from(spaceInvites)
          .where(lt(spaceInvites.expiresAt, now))
          .limit(BATCH_LIMIT),
      (ids) => db.delete(spaceInvites).where(inArray(spaceInvites.id, ids)),
    );
  } catch (err) {
    logError("[cleanup] Failed to delete expired space invites:", err);
  }
}

async function cleanupZombieMeetings(
  db: ReturnType<typeof createDb>,
  env: Env,
  now: Date,
): Promise<void> {
  try {
    const threshold = new Date(now.getTime() - ZOMBIE_THRESHOLD_MS);
    const zombies = await db
      .select({ id: meetingSessions.id, activeEgressId: meetingSessions.activeEgressId, hostId: meetingSessions.hostId })
      .from(meetingSessions)
      .where(and(eq(meetingSessions.status, "active"), lt(meetingSessions.startedAt, threshold)))
      .limit(ZOMBIE_BATCH_LIMIT);

    if (zombies.length === 0) return;

    const allIds = zombies.map((m) => m.id);

    // Fetch host plans so we can set the correct retainUntil per meeting
    const hostIds = [...new Set(zombies.map((m) => m.hostId))];
    const hostRows = await db
      .select({ id: users.id, plan: users.plan })
      .from(users)
      .where(inArray(users.id, hostIds));
    const hostPlanMap = new Map(hostRows.map((h) => [h.id, h.plan as PlanType]));

    const hostPlanByMeetingId = new Map<string, PlanType>();
    for (const zombie of zombies) {
      hostPlanByMeetingId.set(zombie.id, hostPlanMap.get(zombie.hostId) ?? "free");
    }

    // Commit DB state first so no subsequent code sees these as active.
    await finalizeMeetingsEndByHostPlan(db, {
      meetingIds: allIds,
      hostPlanByMeetingId,
      now,
      onlyActive: true,
    });
    logInfo(`[cleanup] Closed ${zombies.length} zombie meetingSessions`);

    // Archive transcripts for all zombies now that participants are marked left.
    await Promise.allSettled(
      allIds.map((id) =>
        archiveMeetingTranscriptsToR2(db, env, id).catch((err) => {
          logError(`[cleanup] Transcript archive failed for zombie meeting ${id}:`, err);
        }),
      ),
    );

    // Best-effort LiveKit cleanup only for zombies with a real egress ID.
    // Sentinel strings ("__starting__:…") cannot be passed to stopEgress —
    // the egress never started so there is nothing to stop.
    const withRealEgress = zombies.filter(
      (m) => m.activeEgressId && !m.activeEgressId.startsWith("__starting__:"),
    );
    if (withRealEgress.length > 0) {
      await Promise.allSettled(
        withRealEgress.map((m) =>
          terminateMeetingRoom(env, m.id, m.activeEgressId).catch((err) => {
            logError(`[cleanup] LiveKit cleanup failed for zombie meeting ${m.id}:`, err);
          }),
        ),
      );
    }
  } catch (err) {
    logError("[cleanup] Failed to close zombie meetingSessions:", err);
  }
}

async function cleanupExpiredMeetings(db: ReturnType<typeof createDb>, now: Date): Promise<void> {
  try {
    await deleteInBatches(
      "expired meetingSessions",
      () =>
        db
          .select({ id: meetingSessions.id })
          .from(meetingSessions)
          .where(and(isNotNull(meetingSessions.retainUntil), lt(meetingSessions.retainUntil, now)))
          .limit(BATCH_LIMIT),
      (ids) => db.delete(meetingSessions).where(inArray(meetingSessions.id, ids)),
    );
  } catch (err) {
    logError("[cleanup] Failed to delete expired meetingSessions:", err);
  }
}

async function cleanupStaleLinks(db: ReturnType<typeof createDb>, now: Date): Promise<void> {
  try {
    const stale = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(lt(rooms.expiresAt, now))
      .limit(BATCH_LIMIT);

    if (stale.length === 0) return;

    // Guard: never delete a room that has an open active session.
    const staleIds = stale.map((r) => r.id);
    const activeRoomRows = await db
      .select({ roomId: meetingSessions.roomId })
      .from(meetingSessions)
      .where(and(inArray(meetingSessions.roomId, staleIds), eq(meetingSessions.status, "active")));
    const activeRoomIds = new Set(activeRoomRows.map((r) => r.roomId));
    const safeToDelete = staleIds.filter((id) => !activeRoomIds.has(id));

    if (safeToDelete.length === 0) return;
    await db.delete(rooms).where(inArray(rooms.id, safeToDelete));
    logInfo(`[cleanup] Deleted ${safeToDelete.length} stale rooms`);
  } catch (err) {
    logError("[cleanup] Failed to delete stale rooms:", err);
  }
}

/**
 * Safety net for the LiveKit webhook: if `handleWebhookEvent` failed to write
 * the meeting_artifacts row (transient D1 error, Worker killed, etc.), this catches
 * recording objects that landed in R2 but were never registered.
 *
 * Looks back 48 hours — covers a missed webhook across any daily run.
 * Uses cursor pagination to scan all recordings, not just the first 100 keys.
 * R2 list is a Class B op (free tier: 10M/month) — negligible at this scale.
 */
async function reconcileOrphanedRecordings(
  db: ReturnType<typeof createDb>,
  env: Env,
  now: Date,
): Promise<void> {
  try {
    const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    type R2ListObject = { key: string; size: number; uploaded: Date };
    type R2ListResult = { objects: R2ListObject[]; truncated: boolean; cursor?: string };

    // Page through all recordings/ objects — R2 sorts lexicographically by key,
    // not by upload time, so we cannot stop early and must scan all pages.
    const recentMp4s: R2ListObject[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_R2_PAGES; page++) {
      const listed = (await env.R2_BUCKET.list({
        prefix: "recordings/",
        limit: 100,
        ...(cursor && { cursor }),
      })) as R2ListResult;

      for (const obj of listed.objects) {
        if (obj.uploaded >= cutoff && obj.key.endsWith(".mp4") && obj.size > 0) {
          recentMp4s.push(obj);
        }
      }

      if (!listed.truncated || !listed.cursor) break;
      cursor = listed.cursor;
    }

    if (recentMp4s.length === 0) return;

    // Chunk r2Key lookups to respect D1's 100-param limit
    const r2Keys = recentMp4s.map((o) => o.key);
    const registeredKeys = new Set<string>();
    for (const chunk of chunkArray(r2Keys, 100)) {
      const existing = await db
        .select({ r2Key: meetingArtifacts.r2Key })
        .from(meetingArtifacts)
        .where(inArray(meetingArtifacts.r2Key, chunk));
      for (const row of existing) {
        registeredKeys.add(row.r2Key);
      }
    }

    const orphaned = recentMp4s.filter((o) => !registeredKeys.has(o.key));
    if (orphaned.length === 0) return;

    logInfo(`[cleanup] Found ${orphaned.length} orphaned recording(s), attempting registration`);

    // Chunk meeting ID lookups to respect D1's 100-param limit
    const meetingIds = [...new Set(orphaned.map((o) => o.key.split("/")[1]).filter(Boolean))];
    const meetingMap = new Map<string, { id: string; spaceId: string | null; hostId: string }>();
    for (const chunk of chunkArray(meetingIds, 100)) {
      const meetingRows = await db
        .select({ id: meetingSessions.id, spaceId: meetingSessions.spaceId, hostId: meetingSessions.hostId })
        .from(meetingSessions)
        .where(inArray(meetingSessions.id, chunk));
      for (const m of meetingRows) {
        meetingMap.set(m.id, m);
      }
    }

    for (const obj of orphaned) {
      const meetingId = obj.key.split("/")[1];
      if (!meetingId) continue;

      const meeting = meetingMap.get(meetingId);
      if (!meeting) continue;

      try {
        await registerMeetingArtifactMetadata(db, {
          spaceId: meeting.spaceId,
          meetingId: meeting.id,
          type: "recording",
          r2Key: obj.key,
          filename: obj.key.split("/").pop() ?? obj.key,
          mimeType: "video/mp4",
          size: obj.size,
          uploadedById: meeting.hostId,
          createdAt: now,
        });
        logInfo(`[cleanup] Reconciled orphaned recording: ${obj.key}`);
      } catch (err) {
        logError(`[cleanup] Failed to reconcile recording ${obj.key}:`, err);
      }
    }
  } catch (err) {
    logError("[cleanup] Recording reconciliation failed:", err);
  }
}
