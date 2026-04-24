import type { Database } from "@ossmeet/db";
import { findSpaceMembership } from "./helpers";

type InviteRole = "admin" | "member";

interface InviteForRoleResolution {
  role: InviteRole;
  spaceId: string;
  createdById: string | null;
}

/**
 * Resolve the effective role an invite should grant.
 *
 * Prevents stale invite escalation: if the creator of an admin invite has since
 * been demoted to member or removed from the space, the invite is downgraded to
 * "member". An owner's admin invite is always honoured.
 */
export async function resolveInviteEffectiveRole(
  db: Database,
  invite: InviteForRoleResolution,
): Promise<InviteRole> {
  if (!invite.createdById) return "member"; // Creator was deleted — safe default to prevent role escalation

  const creatorMembership = await findSpaceMembership(db, invite.spaceId, invite.createdById);
  if (!creatorMembership) {
    // Creator was removed from the space — downgrade to member
    return "member";
  }
  if (invite.role === "admin" && creatorMembership.role === "member") {
    // Creator was demoted — downgrade invite role
    return "member";
  }
  return invite.role;
}
