import { createServerFn } from "@tanstack/react-start";
import { meetingArtifacts, spaces, spaceMembers, meetingSessions, spaceInvites, spaceAssets, rooms, users } from "@ossmeet/db/schema";
import { eq, and, count, isNull, inArray, asc } from "drizzle-orm";
import {
  createSpaceSchema,
  updateSpaceSchema,
  deleteSpaceSchema,
  getSpaceSchema,
  generateId,
  Errors,
  getPlanLimits,
  chunkArrayForD1Parameters,
} from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { enforceRateLimit } from "../auth/helpers";
import { authMiddleware } from "../middleware";
import { logError } from "@/lib/logger";
import { terminateMeetingRoom } from "../meetings/leave-end";
import { findSpaceMembership } from "./helpers";
import { finalizeMeetingsEndByHostPlan } from "../meetings/finalize";

export const createSpace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(createSpaceSchema)
  .handler(async ({ data, context: { user, env, db } }) => {

    await enforceRateLimit(env, `space:create:${user.id}`);

    const plan = (user.plan as PlanType) ?? "free";
    const limits = getPlanLimits(plan);

    // Enforce space count limit
    if (limits.maxSpaces !== null) {
      const [owned] = await db
        .select({ count: count() })
        .from(spaces)
        .where(and(eq(spaces.ownerId, user.id), isNull(spaces.archivedAt)));

      if (owned.count >= limits.maxSpaces) {
        throw Errors.PLAN_LIMIT_REACHED(
          `Maximum ${limits.maxSpaces} space(s) on your plan`
        );
      }
    }

    const slugBase = data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "space";
    const now = new Date();

    // Retry on slug collision (extremely unlikely with UUID suffix)
    for (let attempt = 0; attempt < 3; attempt++) {
      // Generate spaceId inside retry loop to avoid cross-attempt collisions
      const spaceId = generateId("SPACE");
      const slug = slugBase + "-" + crypto.randomUUID().slice(0, 8);
      try {
        await db.batch([
          db.insert(spaces).values({
            id: spaceId,
            name: data.name,
            description: data.description ?? null,
            slug,
            ownerId: user.id,
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(spaceMembers).values({
            id: generateId("MEMBER"),
            spaceId,
            userId: user.id,
            role: "owner",
            joinedAt: now,
          }),
        ]);

        // Post-insert cap check (TOCTOU mitigation for concurrent createSpace calls)
        if (limits.maxSpaces !== null) {
          // Use deterministic winner: keep the space with the earliest ID
          const activeSpaces = await db
            .select({ id: spaces.id })
            .from(spaces)
            .where(and(eq(spaces.ownerId, user.id), isNull(spaces.archivedAt)))
            .orderBy(asc(spaces.createdAt));

          if (activeSpaces.length > limits.maxSpaces) {
            // Only roll back if this space is NOT among the earliest N
            const keepIds = new Set(activeSpaces.slice(0, limits.maxSpaces).map(s => s.id));
            if (!keepIds.has(spaceId)) {
              // spaceMembers cascade-deleted via FK onDelete: "cascade"
              await db.delete(spaces).where(eq(spaces.id, spaceId));
              throw Errors.PLAN_LIMIT_REACHED(`Maximum ${limits.maxSpaces} space(s) on your plan`);
            }
          }
        }

        return { spaceId, slug };
      } catch (err) {
        // Retry only on unique constraint violations
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("UNIQUE") || attempt === 2) throw err;
      }
    }
    throw Errors.VALIDATION("Failed to create space, please try again");
  });

export const updateSpace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(updateSpaceSchema)
  .handler(async ({ data, context: { user, env: _env, db } }) => {

    const space = await db.query.spaces.findFirst({
      where: and(eq(spaces.id, data.spaceId), isNull(spaces.archivedAt)),
      columns: { id: true },
    });
    if (!space) throw Errors.NOT_FOUND("Space");

    const membership = await findSpaceMembership(db, data.spaceId, user.id);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      throw Errors.FORBIDDEN();
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;

    await db.update(spaces).set(updates).where(eq(spaces.id, data.spaceId));

    return { success: true };
  });

export const deleteSpace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(deleteSpaceSchema)
  .handler(async ({ data, context: { user, env, db } }) => {

    // Only allow archiving spaces that aren't already archived
    const space = await db.query.spaces.findFirst({
      where: and(eq(spaces.id, data.spaceId), isNull(spaces.archivedAt)),
    });

    if (!space || space.ownerId !== user.id) throw Errors.FORBIDDEN();

    const now = new Date();

    // End all active meetingSessions in this space
    const activeMeetings = await db
      .select({ id: meetingSessions.id, activeEgressId: meetingSessions.activeEgressId, hostId: meetingSessions.hostId })
      .from(meetingSessions)
      .where(and(eq(meetingSessions.spaceId, data.spaceId), eq(meetingSessions.status, "active")));

    if (activeMeetings.length > 0) {
      const meetingIds = activeMeetings.map((m) => m.id);
      const hostIds = Array.from(new Set(activeMeetings.map((m) => m.hostId)));
      const hostRows: Array<{ id: string; plan: string }> = [];
      for (const chunk of chunkArrayForD1Parameters(hostIds)) {
        hostRows.push(
          ...(await db
            .select({ id: users.id, plan: users.plan })
            .from(users)
            .where(inArray(users.id, chunk))),
        );
      }
      const hostPlanMap = new Map(hostRows.map((row) => [row.id, row.plan as PlanType]));
      const hostPlanByMeetingId = new Map<string, PlanType>();
      for (const activeMeeting of activeMeetings) {
        hostPlanByMeetingId.set(activeMeeting.id, hostPlanMap.get(activeMeeting.hostId) ?? "free");
      }
      await finalizeMeetingsEndByHostPlan(db, {
        meetingIds,
        hostPlanByMeetingId,
        now,
        onlyActive: true,
      });

      // Terminate LiveKit rooms in parallel
      await Promise.allSettled(
        activeMeetings.map(async (m) => {
          await terminateMeetingRoom(env, m.id, m.activeEgressId).catch((err) => {
            logError(`[spaces] Failed to terminate room for meeting ${m.id}:`, err);
          });
        })
      );
    }

    // Collect asset R2 keys before DB deletion
    const [uploadedAssets, generatedArtifacts] = await Promise.all([
      db
        .select({ id: spaceAssets.id, r2Key: spaceAssets.r2Key })
        .from(spaceAssets)
        .where(eq(spaceAssets.spaceId, data.spaceId)),
      db
        .select({ id: meetingArtifacts.id, r2Key: meetingArtifacts.r2Key })
        .from(meetingArtifacts)
        .where(eq(meetingArtifacts.spaceId, data.spaceId)),
    ]);
    const assets = [...uploadedAssets, ...generatedArtifacts];

    // Delete all meetingSessions for this space before the space itself.
    // The FK now cascades, but deleting meetingSessions explicitly keeps the intent clear
    // and guarantees meeting-owned artifacts/transcripts disappear in one step.
    await db.delete(meetingSessions).where(eq(meetingSessions.spaceId, data.spaceId));

    // Delete rooms for this space before the space itself.
    // The FK cascades, but removing them explicitly makes the deletion order obvious.
    await db.delete(rooms).where(eq(rooms.spaceId, data.spaceId));

    // Hard-delete everything consistently (soft-delete was useless since
    // members/assets were hard-deleted, making restore impossible)
    await db.batch([
      db.delete(spaceInvites).where(eq(spaceInvites.spaceId, data.spaceId)),
      db.delete(meetingArtifacts).where(eq(meetingArtifacts.spaceId, data.spaceId)),
      db.delete(spaceAssets).where(eq(spaceAssets.spaceId, data.spaceId)),
      db.delete(spaceMembers).where(eq(spaceMembers.spaceId, data.spaceId)),
      db.delete(spaces).where(eq(spaces.id, data.spaceId)),
    ]);

    // Best-effort R2 cleanup after DB commit (parallel for performance)
    if (assets.length > 0) {
      const results = await Promise.allSettled(
        assets.map((asset) => env.R2_BUCKET.delete(asset.r2Key))
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        logError(
          `[spaces] Failed to delete ${failed.length}/${assets.length} R2 objects for space ${data.spaceId}:`,
          failed.map((r, idx) => ({
            key: assets[idx].r2Key,
            error: (r as PromiseRejectedResult).reason instanceof Error
              ? (r as PromiseRejectedResult).reason.message
              : String((r as PromiseRejectedResult).reason)
          }))
        );
        // Note: Orphaned objects will be cleaned up by lifecycle policy
        // or manual reconciliation job. DB records are already deleted.
      }
    }

    return { success: true };
  });

export const getSpace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(getSpaceSchema)
  .handler(async ({ data, context: { user, env: _env, db } }) => {

    const space = await db.query.spaces.findFirst({
      where: and(eq(spaces.id, data.spaceId), isNull(spaces.archivedAt)),
      with: {
        members: {
          with: {
            user: {
              columns: {
                id: true,
                name: true,
                image: true,
                plan: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!space) throw Errors.NOT_FOUND("Space");

    // Derive membership from the already-loaded members list (saves a DB round-trip)
    const membership = space.members.find((m) => m.userId === user.id);
    if (!membership) throw Errors.FORBIDDEN();

    const callerIsAdmin = membership.role === "owner" || membership.role === "admin";

    // Strip sensitive billing (plan) and system-role fields from member records.
    // Only admins and owners need plan info; the system role is internal and
    // should never be visible to regular space members.
    const sanitizedMembers = space.members.map((m) => ({
      ...m,
      user: {
        id: m.user.id,
        name: m.user.name,
        image: m.user.image,
        // Expose plan only to admins/owners; expose system role to nobody
        ...(callerIsAdmin ? { plan: m.user.plan } : {}),
      },
    }));

    return { space: { ...space, members: sanitizedMembers }, role: membership.role };
  });

export const getMySpaces = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { user, env: _env, db } }) => {

  // Filter active spaces at DB level instead of JS
  const results = await db
    .select({
      space: spaces,
      role: spaceMembers.role,
    })
    .from(spaceMembers)
    .innerJoin(spaces, and(eq(spaceMembers.spaceId, spaces.id), isNull(spaces.archivedAt)))
    .where(eq(spaceMembers.userId, user.id));

  return {
    spaces: results.map((r) => ({ ...r.space, role: r.role })),
  };
});
