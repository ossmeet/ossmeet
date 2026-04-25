import { createServerFn } from "@tanstack/react-start";
import { spaces, spaceMembers, spaceInvites } from "@ossmeet/db/schema";
import { eq, and, gte, sql, isNull } from "drizzle-orm";
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
    const nowSeconds = Math.floor(now.getTime() / 1000);

    // For limited invites, pre-check capacity before attempting the insert
    if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
      throw Errors.VALIDATION("This invite has been used up");
    }

    // Keep the membership insert, invite usage update, and space touch inside a
    // single D1 batch transaction so a later failure cannot leave partial state.
    try {
      if (invite.maxUses !== null) {
        const [memberInsertResult] = await env.DB.batch([
          env.DB
            .prepare(
              `INSERT INTO space_members (id, space_id, user_id, role, joined_at)
               SELECT ?, ?, ?, ?, ?
               WHERE EXISTS (
                 SELECT 1
                 FROM space_invites
                 WHERE id = ?
                   AND max_uses IS NOT NULL
                   AND use_count < max_uses
               )`,
            )
            .bind(memberId, invite.spaceId, user.id, effectiveRole, nowSeconds, invite.id),
          env.DB
            .prepare(
              `UPDATE space_invites
               SET use_count = use_count + 1
               WHERE id = ?
                 AND max_uses IS NOT NULL
                 AND use_count < max_uses
                 AND EXISTS (SELECT 1 FROM space_members WHERE id = ?)`,
            )
            .bind(invite.id, memberId),
          env.DB
            .prepare(
              `UPDATE spaces
               SET updated_at = ?
               WHERE id = ?
                 AND EXISTS (SELECT 1 FROM space_members WHERE id = ?)`,
            )
            .bind(nowSeconds, invite.spaceId, memberId),
        ]);

        if (getRunChanges(memberInsertResult) === 0) {
          throw Errors.VALIDATION("This invite has been used up");
        }
      } else {
        await db.batch([
          db.insert(spaceMembers).values({
            id: memberId,
            spaceId: invite.spaceId,
            userId: user.id,
            role: effectiveRole,
            joinedAt: now,
          }),
          db
            .update(spaceInvites)
            .set({ useCount: sql`${spaceInvites.useCount} + 1` })
            .where(eq(spaceInvites.id, invite.id)),
          db.update(spaces).set({ updatedAt: now }).where(eq(spaces.id, invite.spaceId)),
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("UNIQUE")) {
        return { spaceId: invite.spaceId, alreadyMember: true };
      }
      if (err instanceof Error && "code" in err) {
        throw err;
      }
      throw Errors.VALIDATION("Failed to join space");
    }

    return { spaceId: invite.spaceId, alreadyMember: false };
  });
