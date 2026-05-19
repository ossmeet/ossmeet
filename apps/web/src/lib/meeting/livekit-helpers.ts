/**
 * Common LiveKit utility functions shared across hooks and server code.
 */

/**
 * Convert a LiveKit URL to HTTP(S) for server-side API calls.
 * ws:// → http://, wss:// → https://; http:// and https:// pass through unchanged.
 */
export function livekitHttpUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  else if (parsed.protocol === "wss:") parsed.protocol = "https:";
  return parsed.toString().replace(/\/$/, "");
}

/**
 * Detect expected errors that occur when publishing data after a LiveKit
 * connection has been closed. These are harmless and should be silenced
 * rather than logged as errors.
 */
export function isExpectedClosedPublishError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("pc manager is closed") ||
    message.includes("unexpectedconnectionstate") ||
    message.includes("not connected")
  );
}
