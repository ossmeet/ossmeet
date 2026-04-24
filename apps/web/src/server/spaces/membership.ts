import { createServerFn } from "@tanstack/react-start";
import { spaces, spaceMembers, users } from "@ossmeet/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  addMemberSchema,
  addMemberByEmailSchema,
  removeMemberSchema,
  leaveSpaceSchema,
  generateId,
  normalizeEmail,
  Errors,
} from "@ossmeet/shared";
import { enforceRateLimit } from "../auth/helpers";
import { authMiddleware } from "../middleware";
import { findSpaceMembership, evictUserFromSpaceMeetings } from "./helpers";

export const addMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(addMemberSchema)
  .handler(async ({ data, context: { user, env, db } }) => {

    await enforceRateLimit(env, `space:addMember:${user.id}`);

    const space = await db.query.spaces.findFirst({
      where: and(eq(spaces.id, data.spaceId), isNull(spaces.archivedAt)),
      columns: { id: true },
    });
    if (!space) throw Errors.NOT_FOUND("Space");

    const membership = await findSpaceMembership(db, data.spaceId, user.id);
    if (!membership || membership.role === "member") throw Errors.FORBIDDEN();

    if (data.role === "admin" && membership.role !== "owner") {
      throw Errors.FORBIDDEN();
    }

    // Verify target user exists before inserting
    const targetUser = await db.query.users.findFirst({
      where: eq(users.id, data.userId),
      columns: { id: true },
    });
    if (!targetUser) throw Errors.NOT_FOUND("User");

    const now = new Date();
    const insertResult = await db.insert(spaceMembers).values({
      id: generateId("MEMBER"),
      spaceId: data.spaceId,
      userId: data.userId,
      role: data.role,
      joinedAt: now,
    }).onConflictDoNothing().run();

    const changes = (insertResult as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes === 0) {
      return { success: true, alreadyMember: true };
    }

    // Touch spaces.updatedAt on membership change
    await db.update(spaces).set({ updatedAt: now }).where(eq(spaces.id, data.spaceId));

    return { success: true };
  });

export const addMemberByEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(addMemberByEmailSchema)
  .handler(async ({ data, context: { user, env, db } }) => {

    await enforceRateLimit(env, `add-member:${user.id}`);

    // Verify space is active (consistent with addMember and createInvite)
    const spaceCheck = await db.query.spaces.findFirst({
      where: and(eq(spaces.id, data.spaceId), isNull(spaces.archivedAt)),
      columns: { id: true },
    });
    if (!spaceCheck) throw Errors.NOT_FOUND("Space");

    // Check caller is admin/owner
    const callerMembership = await findSpaceMembership(db, data.spaceId, user.id);
    if (!callerMembership || callerMembership.role === "member") {
      throw Errors.FORBIDDEN();
    }

    // Prevent non-owners from adding admins
    if (data.role === "admin" && callerMembership.role !== "owner") {
      throw Errors.FORBIDDEN();
    }

    // Find target user by email
    const normalized = normalizeEmail(data.email);
    const targetUser = await db.query.users.findFirst({
      where: eq(users.normalizedEmail, normalized),
      columns: { id: true, name: true },
    });
    if (!targetUser) {
      throw Errors.NOT_FOUND("No user found with that email. They must sign up first.");
    }

    // Insert membership
    const insertResult = await db
      .insert(spaceMembers)
      .values({
        id: generateId("MEMBER"),
        spaceId: data.spaceId,
        userId: targetUser.id,
        role: data.role ?? "member",
        joinedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();

    const changes = (insertResult as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes > 0) {
      await db.update(spaces).set({ updatedAt: new Date() }).where(eq(spaces.id, data.spaceId));
    }

    return { success: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(removeMemberSchema)
  .handler(async ({ data, context: { user, env, db } }) => {

    await enforceRateLimit(env, `space:removeMember:${user.id}`);

    const spaceCheck = await db.query.spaces.findFirst({
      where: and(eq(spaces.id, data.spaceId), isNull(spaces.archivedAt)),
      columns: { id: true },
    });
    if (!spaceCheck) throw Errors.NOT_FOUND("Space");

    const membership = await findSpaceMembership(db, data.spaceId, user.id);
    if (!membership || membership.role === "member") throw Errors.FORBIDDEN();

    // Look up the target member's role
    const targetMembership = await findSpaceMembership(db, data.spaceId, data.userId);
    if (!targetMembership) throw Errors.NOT_FOUND("Member");

    // Nobody can remove the owner
    if (targetMembership.role === "owner") throw Errors.FORBIDDEN();

    // Only owner can remove admins
    if (targetMembership.role === "admin" && membership.role !== "owner") {
      throw Errors.FORBIDDEN();
    }

    await evictUserFromSpaceMeetings(db, env, data.spaceId, data.userId);

    // Touch spaces.updatedAt on membership change
    await db.update(spaces).set({ updatedAt: new Date() }).where(eq(spaces.id, data.spaceId));

    return { success: true };
  });

export const leaveSpace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(leaveSpaceSchema)
  .handler(async ({ data, context: { user, env, db } }) => {

    await enforceRateLimit(env, `space:leave:${user.id}`);

    const membership = await findSpaceMembership(db, data.spaceId, user.id);
    if (!membership) throw Errors.NOT_FOUND("Membership");

    // Owners cannot leave — they must transfer ownership or delete the space
    if (membership.role === "owner") {
      throw Errors.VALIDATION("Owners cannot leave a space. Transfer ownership or delete the space instead.");
    }

    await evictUserFromSpaceMeetings(db, env, data.spaceId, user.id);

    await db.update(spaces).set({ updatedAt: new Date() }).where(eq(spaces.id, data.spaceId));

    return { success: true };
  });
