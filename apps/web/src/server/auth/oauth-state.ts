const MAX_OAUTH_STATE_HASHES = 5;

export function parseOAuthStateCookie(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(".")
    .map((entry) => entry.trim())
    .filter((entry) => /^[a-f0-9]{64}$/i.test(entry));
}

export function addOAuthStateHash(
  existingValue: string | null | undefined,
  nextHash: string,
): string {
  const existing = parseOAuthStateCookie(existingValue).filter(
    (entry) => entry !== nextHash,
  );
  existing.push(nextHash);
  return existing.slice(-MAX_OAUTH_STATE_HASHES).join(".");
}

export function removeOAuthStateHash(
  existingValue: string | null | undefined,
  hashToRemove: string,
): string {
  return parseOAuthStateCookie(existingValue)
    .filter((entry) => entry !== hashToRemove)
    .join(".");
}

export function hasOAuthStateHash(
  existingValue: string | null | undefined,
  expectedHash: string,
): boolean {
  return parseOAuthStateCookie(existingValue).includes(expectedHash);
}
