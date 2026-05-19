/**
 * Normalize email for deduplication.
 * - Lowercase
 * - For Gmail: strip dots and +aliases from local part
 * - Only strip +aliases for providers known to support them
 */

// Providers that are known to treat user+tag as an alias of user
const PLUS_ALIAS_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "fastmail.com",
];

export function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().trim().split("@");
  if (!local || !domain) return email.toLowerCase().trim();

  // Gmail and Google-hosted domains: strip dots and canonicalize to gmail.com
  const gmailDomains = ["gmail.com", "googlemail.com"];
  if (gmailDomains.includes(domain)) {
    const stripped = local.replace(/\./g, "").split("+")[0];
    return `${stripped}@gmail.com`;
  }

  if (PLUS_ALIAS_DOMAINS.includes(domain)) {
    const strippedLocal = local.split("+")[0];
    return `${strippedLocal}@${domain}`;
  }

  return `${local}@${domain}`;
}
