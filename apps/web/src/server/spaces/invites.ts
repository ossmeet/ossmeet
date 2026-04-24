import { createServerFn } from "@tanstack/react-start";
import { spaces, spaceMembers, spaceInvites } from "@ossmeet/db/schema";
import { eq, and, gte, lt, sql, isNull } from "drizzle-orm";
import {
  createInviteSchema,
  joinViaInviteSchema,
  generateId,
  Errors,
} from "@ossmeet/shared";
import { enforceIpRateLimit, enforceRateLimit } from "../auth/helpers";
import { authMiddleware } from "../middleware";
import { hashSessionToken } from "@/lib/auth/crypto";
import { findSpaceMembership } from "./helpers";
import { resolveInviteEffectiveRole } from "./invite-logic";
import { getRunChanges } from "@/lib/db-utils";

export const createInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(createInviteSchema)
  .handler(async ({ data, context: { user, env, db } }) => {

    await enforceRateLimit(env, `invite:create:${user.id}`);

    const spaceForInvite = await db.query.spaces.findFirst({
      where: and(eq(spaces.id, data.spaceId), isNull(spaces.archivedAt)),
      columns: { id: true },
    });
    if (!spaceForInvite) throw Errors.NOT_FOUND("Space");

    const membership = await findSpaceMembership(db, data.spaceId, user.id);
    if (!membership || membership.role === "member") throw Errors.FORBIDDEN();

    if (data.role === "admin" && membership.role !== "owner") {
      throw Errors.FORBIDDEN();
    }

    const token = crypto.randomUUID();
    const tokenHash = await hashSessionToken(token);
    const expiresAt = new Date(
      Date.now() + (data.expiresInHours ?? 24) * 60 * 60 * 1000
    );

    await db.insert(spaceInvites).values({
      id: generateId("INVITE"),
      spaceId: data.spaceId,
      token: tokenHash,
      createdById: user.id,
      role: data.role,
      expiresAt,
      maxUses: data.maxUses ?? null,
    });

    // Return plaintext token once — only the hash is stored
    return { token, expiresAt: expiresAt.toISOString() };
  });

export const joinViaInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(joinViaInviteSchema)
  .handler(async ({ data, context: { user, env, db } }) => {

    await enforceIpRateLimit(env, "join-invite");

    // Compare by hash — plaintext token is never stored
    const tokenHash = await hashSessionToken(data.token);
    const invite = await db.query.spaceInvites.findFirst({
      where: and(
        eq(spaceInvites.token, tokenHash),
        gte(spaceInvites.expiresAt, new Date())
      ),
    });

    if (!invite) throw Errors.NOT_FOUND("Invite");

    const inviteSpace = await db.query.spaces.findFirst({
      where: and(eq(spaces.id, invite.spaceId), isNull(spaces.archivedAt)),
      columns: { id: true },
    });
    if (!inviteSpace) throw Errors.NOT_FOUND("Space");

    // Check if already a member
    const existing = await findSpaceMembership(db, invite.spaceId, user.id);
    if (existing) return { spaceId: invite.spaceId, alreadyMember: true };

    // Re-verify invite creator's current role to prevent stale invite escalation
    const effectiveRole = await resolveInviteEffectiveRole(db, invite);

    const memberId = generateId("MEMBER");
    const now = new Date();

    // For limited invites, pre-check capacity before attempting the insert
    if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
      throw Errors.VALIDATION("This invite has been used up");
    }

    // Insert the member first — unique constraint prevents duplicates.
    // Only increment use-count AFTER successful insert to avoid consuming
    // uses on failed inserts (which would permanently lock limited invites).
    try {
      await db.insert(spaceMembers).values({
        id: memberId,
        spaceId: invite.spaceId,
        userId: user.id,
        role: effectiveRole,
        joinedAt: now,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("UNIQUE")) {
        return { spaceId: invite.spaceId, alreadyMember: true };
      }
      throw Errors.VALIDATION("Failed to join space");
    }

    // Now atomically increment use-count (with capacity guard for limited invites)
    if (invite.maxUses !== null) {
      const updateResult = await db
        .update(spaceInvites)
        .set({ useCount: sql`${spaceInvites.useCount} + 1` })
        .where(
          and(
            eq(spaceInvites.id, invite.id),
            lt(spaceInvites.useCount, spaceInvites.maxUses)
          )
        )
        .run();

      const changes = getRunChanges(updateResult);
      if (changes === 0) {
        // Race: invite was used up between our check and here — roll back member
        await db.delete(spaceMembers).where(eq(spaceMembers.id, memberId));
        throw Errors.VALIDATION("This invite has been used up");
      }
    } else {
      await db
        .update(spaceInvites)
        .set({ useCount: sql`${spaceInvites.useCount} + 1` })
        .where(eq(spaceInvites.id, invite.id));
    }

    // Touch spaces.updatedAt on membership change
    await db.update(spaces).set({ updatedAt: now }).where(eq(spaces.id, invite.spaceId));

    return { spaceId: invite.spaceId, alreadyMember: false };
  });
