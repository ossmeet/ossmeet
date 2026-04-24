export const MIN_TOKEN_REFRESH_DELAY_MS = 5_000;
export const TOKEN_REFRESH_BUFFER_MS = 30_000;
export const MAX_TOKEN_REFRESH_RETRY_DELAY_MS = 60_000;

export function getMeetingTokenRefreshDelayMs(expiresInSeconds: number): number {
  const ttlMs = expiresInSeconds * 1000;
  return Math.max(
    MIN_TOKEN_REFRESH_DELAY_MS,
    Math.min(ttlMs * 0.8, ttlMs - TOKEN_REFRESH_BUFFER_MS),
  );
}

export function getMeetingTokenRefreshFailureMessage(err: unknown): string | null {
  const errCode =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";

  if (errCode === "NOT_FOUND") {
    return "Meeting has ended. Please rejoin.";
  }

  if (errCode === "FORBIDDEN" || errCode === "UNAUTHORIZED") {
    return "Your access to this meeting changed. Please rejoin.";
  }

  return null;
}

export function getMeetingTokenRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(0, attempt);
  const exp = Math.min(MAX_TOKEN_REFRESH_RETRY_DELAY_MS, MIN_TOKEN_REFRESH_DELAY_MS * 2 ** safeAttempt);
  const jitter = Math.floor(Math.random() * 800);
  return Math.min(MAX_TOKEN_REFRESH_RETRY_DELAY_MS, exp + jitter);
}
