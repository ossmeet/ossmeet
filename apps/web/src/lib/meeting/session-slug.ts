export function createSessionSlug(now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 4);
  return `${day}-${suffix}`;
}
