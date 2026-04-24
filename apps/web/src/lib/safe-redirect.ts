const ALLOWED_REDIRECT_PREFIXES = [
  "/dashboard",
  "/spaces",
  "/settings",
  "/invite",
] as const;

const MEETING_CODE_RE = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export function isSafeInternalRedirect(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (MEETING_CODE_RE.test(value)) return true;
  return ALLOWED_REDIRECT_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`)
  );
}

export function sanitizeInternalRedirect(value: unknown): string | undefined {
  return typeof value === "string" && isSafeInternalRedirect(value)
    ? value
    : undefined;
}
