/**
 * Sanitize a display name for safe rendering.
 * Strips HTML tags, control characters, normalizes whitespace.
 */
export function sanitizeDisplayName(
  raw: string,
  fallback = "Guest"
): string {
  return (
    raw
      .replace(/<[^>]*>/g, "") // Strip HTML tags
      .replace(/[\x00-\x1F\x7F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "") // Strip control + bidi chars
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim()
      .slice(0, 100) || fallback // Self-contained max length
  );
}
