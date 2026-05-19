import { createDb } from "@ossmeet/db";
import {
  sessions,
  devices,
  verifications,
  spaceInvites,
  meetingArtifacts,
  meetingSessions,
  rooms,
} from "@ossmeet/db/schema";
import { lt, and, eq, isNotNull, or, inArray } from "drizzle-orm";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { chunkArray } from "@ossmeet/shared";
import { endSession } from "./meetings/leave-end.server";
import { registerMeetingArtifactMetadata } from "./assets/register";
import { cleanupStaleSessionsWithoutLiveKitRoom } from "./meetings/stale-sessions";

// Rows to delete per batch iteration. Keep below D1's 100-parameter ceiling so
// callers can add small predicates to follow-up queries.
const BATCH_LIMIT = 90;
// Separate limit for zombies: each triggers external LiveKit API calls.
const ZOMBIE_BATCH_LIMIT = 50;
// Meetings stuck in "active" longer than this are considered zombies.
const ZOMBIE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
// Max batch iterations per cleanup run — prevents runaway loops on large backlogs.
const MAX_BATCH_ITERATIONS = 10;

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
  const errors: unknown[] = [];

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (err) { errors.push(err); }
  };

  if (cron === CRON_FREQUENT) {
    await run(() => cleanupExpiredSessions(db, now));
    await run(() => cleanupExpiredDevices(db, now));
    await run(() => cleanupExpiredVerifications(db, now));
    await run(async () => { await cleanupStaleSessionsWithoutLiveKitRoom(db, env, now); });
  } else if (cron === CRON_DAILY) {
    await run(() => cleanupExpiredSessions(db, now));
    await run(() => cleanupExpiredDevices(db, now));
    await run(() => cleanupExpiredVerifications(db, now));
    await run(() => cleanupExpiredInvites(db, now));
    await run(() => cleanupZombieMeetings(db, env, now));
    await run(() => cleanupExpiredMeetings(db, env, now));
    await run(() => cleanupStaleLinks(db, now));
    await run(() => reconcileOrphanedRecordings(db, env, now));
  } else {
    logWarn(`[cleanup] Unrecognized cron expression: ${cron}`);
  }

  if (errors.length > 0) {
    logError(`[cleanup] ${errors.length} step(s) failed during ${cron}`, errors);
    throw new Error(`Cleanup failed: ${errors.length} step(s) errored`);
  }
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
    throw err;
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
    throw err;
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
    throw err;
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
    throw err;
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
      .select({ id: meetingSessions.id })
      .from(meetingSessions)
      .where(and(eq(meetingSessions.status, "active"), lt(meetingSessions.startedAt, threshold)))
      .limit(ZOMBIE_BATCH_LIMIT);

    if (zombies.length === 0) return;

    // endSession is idempotent and bundles DB finalize + post-meeting tasks
    // (transcript archive, whiteboard /session-end) + LiveKit teardown.
    const results = await Promise.allSettled(
      zombies.map((m) => endSession(db, env, m.id, "stale")),
    );
    logInfo(`[cleanup] Closed ${zombies.length} zombie meetingSessions`);

    const errors: unknown[] = [];
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        logError(`[cleanup] Zombie cleanup failed for ${zombies[i].id}:`, result.reason);
        errors.push(result.reason);
      }
    });
    if (errors.length > 0) {
      throw new AggregateError(errors, "Zombie meeting cleanup completed with partial failures");
    }
  } catch (err) {
    logError("[cleanup] Failed to close zombie meetingSessions:", err);
    throw err;
  }
}

async function cleanupExpiredMeetings(
  db: ReturnType<typeof createDb>,
  env: Env,
  now: Date,
): Promise<void> {
  try {
    let total = 0;
    for (let i = 0; i < MAX_BATCH_ITERATIONS; i++) {
      const batch = await db
        .select({ id: meetingSessions.id, roomId: meetingSessions.roomId })
        .from(meetingSessions)
        .where(and(isNotNull(meetingSessions.retainUntil), lt(meetingSessions.retainUntil, now)))
        .limit(BATCH_LIMIT);

      if (batch.length === 0) break;
      const ids = batch.map((r) => r.id);
      const candidateRoomIds = Array.from(new Set(batch.map((r) => r.roomId)));

      const artifacts = await db
        .select({ r2Key: meetingArtifacts.r2Key })
        .from(meetingArtifacts)
        .where(inArray(meetingArtifacts.sessionId, ids));

      // Delete the DB rows first so a mid-flight failure cannot leave database
      // records pointing at already-deleted objects. Any later R2 failure only
      // leaves orphaned objects, which is safer and easier to clean up.
      await db.delete(meetingSessions).where(inArray(meetingSessions.id, ids));
      total += batch.length;

      // Instant rooms are one-shot public addresses. Once their retained
      // session history is gone, remove the parent room too so old random
      // codes don't accumulate forever. Permanent rooms are intentionally kept
      // until their own expiresAt cleanup deletes them.
      if (candidateRoomIds.length > 0) {
        const roomsWithRemainingSessions = await db
          .select({ roomId: meetingSessions.roomId })
          .from(meetingSessions)
          .where(inArray(meetingSessions.roomId, candidateRoomIds));
        const remainingRoomIds = new Set(roomsWithRemainingSessions.map((row) => row.roomId));
        const orphanedRoomIds = candidateRoomIds.filter((roomId) => !remainingRoomIds.has(roomId));
        if (orphanedRoomIds.length > 0) {
          await db
            .delete(rooms)
            .where(and(inArray(rooms.id, orphanedRoomIds), eq(rooms.type, "instant")));
        }
      }

      if (artifacts.length > 0) {
        const keys = artifacts.map((a) => a.r2Key);
        const deleteResults = await Promise.allSettled(keys.map((key) => env.R2_BUCKET.delete(key)));
        let deletedCount = 0;
        deleteResults.forEach((result, index) => {
          if (result.status === "fulfilled") {
            deletedCount++;
            return;
          }
          const key = keys[index];
          logError(`[cleanup] Failed to delete R2 object ${key}:`, result.reason);
        });
        if (deletedCount > 0) {
          logInfo(`[cleanup] Deleted ${deletedCount} R2 objects for expired meetings`);
        }
      }
      if (batch.length < BATCH_LIMIT) break;
    }
    if (total > 0) logInfo(`[cleanup] Deleted ${total} expired meetingSessions`);
  } catch (err) {
    logError("[cleanup] Failed to delete expired meetingSessions:", err);
    throw err;
  }
}

async function cleanupStaleLinks(db: ReturnType<typeof createDb>, now: Date): Promise<void> {
  try {
    let totalDeleted = 0;

    for (let i = 0; i < MAX_BATCH_ITERATIONS; i++) {
      const stale = await db
        .select({ id: rooms.id })
        .from(rooms)
        .where(lt(rooms.expiresAt, now))
        .limit(BATCH_LIMIT);

      if (stale.length === 0) break;

      // Guard: never delete a room that has an open active session.
      const staleIds = stale.map((r) => r.id);
      const activeRoomRows = await db
        .select({ roomId: meetingSessions.roomId })
        .from(meetingSessions)
        .where(and(inArray(meetingSessions.roomId, staleIds), eq(meetingSessions.status, "active")));
      const activeRoomIds = new Set(activeRoomRows.map((r) => r.roomId));
      const safeToDelete = staleIds.filter((id) => !activeRoomIds.has(id));

      if (safeToDelete.length === 0) {
        if (stale.length < BATCH_LIMIT) break;
        continue;
      }

      await db.delete(rooms).where(inArray(rooms.id, safeToDelete));
      totalDeleted += safeToDelete.length;

      if (stale.length < BATCH_LIMIT) break;
    }

    if (totalDeleted > 0) {
      logInfo(`[cleanup] Deleted ${totalDeleted} stale rooms`);
    }
  } catch (err) {
    logError("[cleanup] Failed to delete stale rooms:", err);
    throw err;
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
  // Cap pages to avoid CPU/time exhaustion on large buckets (100 objects × 50 pages = 5 k objects).
  // R2 sorts lexicographically, not by upload time, so we must scan all pages up to the cap.
  const MAX_R2_RECONCILE_PAGES = 50;

  try {
    const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    type R2ListObject = { key: string; size: number; uploaded: Date };
    type R2ListResult = { objects: R2ListObject[]; truncated: boolean; cursor?: string };

    const recentMp4s: R2ListObject[] = [];
    let cursor: string | undefined;
    let pages = 0;
    while (pages < MAX_R2_RECONCILE_PAGES) {
      pages++;
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
    if (pages >= MAX_R2_RECONCILE_PAGES) {
      logWarn("[cleanup] reconcileOrphanedRecordings reached page cap; some objects may not have been scanned");
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

    const reconciliationErrors: Array<{ key: string; error: unknown }> = [];
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
          createdAt: obj.uploaded,
          overwriteOnConflict: false,
        });
        logInfo(`[cleanup] Reconciled orphaned recording: ${obj.key}`);
      } catch (err) {
        logError(`[cleanup] Failed to reconcile recording ${obj.key}:`, err);
        reconciliationErrors.push({ key: obj.key, error: err });
      }
    }

    if (reconciliationErrors.length > 0) {
      throw new AggregateError(
        reconciliationErrors.map(({ error }) => error),
        `[cleanup] Failed to reconcile ${reconciliationErrors.length} recording(s)`,
      );
    }
  } catch (err) {
    logError("[cleanup] Recording reconciliation failed:", err);
    throw err;
  }
}
