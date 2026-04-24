import type { Participant } from "livekit-client";

/**
 * Admin/host detection.
 *
 * Note: the JS ParticipantPermission surface does not expose `roomAdmin`,
 * so role metadata is the reliable source for host checks on clients.
 */
export function hasAdminGrant(
  participant: Participant | null | undefined
): boolean {
  if (!participant) return false;
  try {
    const metadata = JSON.parse(participant.metadata || "{}");
    if (metadata.role === "host") return true;
  } catch {
    // ignore parse failures
  }
  return false;
}
