interface RecoverableGuestParticipant {
  userId: string | null;
  status: string;
  joinedAt: Date | null;
  leftAt: Date | null;
}

const FAILED_INITIAL_GUEST_JOIN_MAX_LIFETIME_MS = 60_000;
const FAILED_INITIAL_GUEST_JOIN_RECONNECT_GRACE_MS = 2 * 60 * 1000;

function getParticipantLifetimeMs(participant: RecoverableGuestParticipant): number | null {
  if (!participant.joinedAt || !participant.leftAt) return null;
  return participant.leftAt.getTime() - participant.joinedAt.getTime();
}

export function shouldPreserveGuestCookieOnPendingLeave(
  participant: RecoverableGuestParticipant,
  now = new Date(),
): boolean {
  if (participant.userId !== null) return false;
  if (participant.status !== "pending") return false;
  if (!participant.joinedAt) return false;
  return now.getTime() - participant.joinedAt.getTime() <= FAILED_INITIAL_GUEST_JOIN_MAX_LIFETIME_MS;
}

export function isRecoverableTerminalGuestReconnect(
  participant: RecoverableGuestParticipant,
  now = new Date(),
): boolean {
  if (participant.userId !== null) return false;
  if (participant.status !== "aborted" && participant.status !== "left") return false;
  if (!participant.leftAt) return false;
  const lifetimeMs = getParticipantLifetimeMs(participant);
  if (lifetimeMs === null || lifetimeMs < 0) return false;
  if (lifetimeMs > FAILED_INITIAL_GUEST_JOIN_MAX_LIFETIME_MS) return false;
  return now.getTime() - participant.leftAt.getTime() <= FAILED_INITIAL_GUEST_JOIN_RECONNECT_GRACE_MS;
}
