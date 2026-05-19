import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { LEGACY_WHITEBOARD_EVENTS, WHITEBOARD_EVENTS } from "./protocol";

export class UnsafeUnfurlTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUnfurlTargetError";
  }
}

const SERVER_ONLY_BROADCAST_TYPES = new Set<string>([
  WHITEBOARD_EVENTS.ACCESS_GRANTED,
  WHITEBOARD_EVENTS.ACCESS_DENIED,
  WHITEBOARD_EVENTS.ACCESS_REVOKED,
  WHITEBOARD_EVENTS.ACCESS_REQUESTED,
  WHITEBOARD_EVENTS.STATE,
  WHITEBOARD_EVENTS.SESSION_ENDING,
  LEGACY_WHITEBOARD_EVENTS.WRITER_APPROVED,
  LEGACY_WHITEBOARD_EVENTS.WRITER_DENIED,
  LEGACY_WHITEBOARD_EVENTS.WRITER_RELEASED,
  LEGACY_WHITEBOARD_EVENTS.WRITER_REQUEST,
  LEGACY_WHITEBOARD_EVENTS.WRITER_STATE,
  LEGACY_WHITEBOARD_EVENTS.SESSION_ENDING,
]);

const MANAGER_BROADCAST_TYPES = new Set<string>([
  // Only the meeting host or acting whiteboard manager can wipe shared assistant history.
  WHITEBOARD_EVENTS.ASSISTANT_CHAT_CLEAR,
]);

// restrict AI/wiki types that could be used for impersonation or prompt injection
const CANVAS_EDIT_BROADCAST_TYPES = new Set<string>([
  WHITEBOARD_EVENTS.ASSISTANT_PANEL_OPEN,   // only canvas editors can open the shared assistant panel
  WHITEBOARD_EVENTS.ASSISTANT_PANEL_CLOSE,  // canvas editors can dismiss the shared assistant panel
  WHITEBOARD_EVENTS.WIKI_SEARCH,            // only canvas editors use wiki search
  WHITEBOARD_EVENTS.WIKI_RESULT,            // prevent fake wiki result injection
]);

const PARTICIPANT_BROADCAST_TYPES = new Set<string>([
  WHITEBOARD_EVENTS.ASSISTANT_CHAT_USER,
  WHITEBOARD_EVENTS.ASSISTANT_CHAT_ASSISTANT,
  WHITEBOARD_EVENTS.ASSISTANT_CHAT_STREAMING,
  // Dismissing a wiki result is harmless
  WHITEBOARD_EVENTS.WIKI_DISMISS,
]);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
]);

const BLOCKED_HOST_SUFFIXES = [
  ".local",
  ".internal",
  ".home",
  ".lan",
  ".arpa",
];

export const MAX_UNFURL_REDIRECTS = 5;

export type RequiredCapability =
  | "server-only"
  | "whiteboard-manager"
  | "canvas-edit"
  | "participant"
  | null;

export type TrustedProxyMatcher =
  | { type: "exact"; ip: string }
  | { type: "ipv4-cidr"; base: number; mask: number };

function normalizeProxyIp(ip: string): string {
  const trimmed = ip.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("::ffff:")) return lower.slice("::ffff:".length);
  return trimmed;
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    result = (result << 8) | value;
  }
  return result >>> 0;
}

function parseTrustedProxyEntry(entry: string): TrustedProxyMatcher | null {
  const normalized = normalizeProxyIp(entry);
  if (!normalized) return null;

  const [baseIp, prefixRaw] = normalized.split("/");
  if (prefixRaw !== undefined) {
    const base = ipv4ToNumber(baseIp);
    const prefix = Number(prefixRaw);
    if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return { type: "ipv4-cidr", base: base & mask, mask };
  }

  return { type: "exact", ip: normalized };
}

export function parseTrustedProxyList(value: string | undefined): TrustedProxyMatcher[] {
  return (value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseTrustedProxyEntry)
    .filter((matcher): matcher is TrustedProxyMatcher => matcher !== null);
}

export function isTrustedProxyIp(ip: string, trustedProxies: readonly TrustedProxyMatcher[]): boolean {
  const normalized = normalizeProxyIp(ip);
  const ipv4 = ipv4ToNumber(normalized);

  return trustedProxies.some((matcher) => {
    if (matcher.type === "exact") return matcher.ip === normalized;
    return ipv4 !== null && (ipv4 & matcher.mask) === matcher.base;
  });
}

export function getBroadcastMessageType(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const type = (data as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}

export function classifyBroadcastAudience(type: string): RequiredCapability {
  if (SERVER_ONLY_BROADCAST_TYPES.has(type)) return "server-only";
  if (MANAGER_BROADCAST_TYPES.has(type)) return "whiteboard-manager";
  if (CANVAS_EDIT_BROADCAST_TYPES.has(type)) return "canvas-edit";
  if (PARTICIPANT_BROADCAST_TYPES.has(type)) return "participant";
  return null;
}

// per-type shape validation for broadcast payloads
// Returns true if the payload shape is acceptable for the given type.
export function validateBroadcastPayload(type: string, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;

  switch (type) {
    case WHITEBOARD_EVENTS.ASSISTANT_PANEL_OPEN:
    case WHITEBOARD_EVENTS.ASSISTANT_PANEL_CLOSE:
    case WHITEBOARD_EVENTS.ASSISTANT_CHAT_CLEAR:
    case WHITEBOARD_EVENTS.WIKI_DISMISS:
      // These types carry no additional fields — reject payloads that embed extra data
      return Object.keys(d).filter((k) => k !== "type").length === 0;

    case WHITEBOARD_EVENTS.ASSISTANT_CHAT_USER:
    case WHITEBOARD_EVENTS.ASSISTANT_CHAT_ASSISTANT: {
      // Must have a message object with id (string), role (user|assistant), content (string)
      const msg = d.message;
      if (!msg || typeof msg !== "object") return false;
      const m = msg as Record<string, unknown>;
      const expectedRole = type === WHITEBOARD_EVENTS.ASSISTANT_CHAT_USER ? "user" : "assistant";
      return (
        typeof m.id === "string" && m.id.length > 0 && m.id.length <= 128 &&
        m.role === expectedRole &&
        typeof m.content === "string" && m.content.length <= 32_000 &&
        (m.userName === undefined || typeof m.userName === "string")
      );
    }

    case WHITEBOARD_EVENTS.ASSISTANT_CHAT_STREAMING: {
      // Must have requestId (string) and streaming (boolean)
      return (
        typeof d.requestId === "string" && d.requestId.length > 0 && d.requestId.length <= 128 &&
        typeof d.streaming === "boolean"
      );
    }

    case WHITEBOARD_EVENTS.WIKI_SEARCH: {
      // Must have query string
      return typeof d.query === "string" && d.query.length > 0 && d.query.length <= 300;
    }

    case WHITEBOARD_EVENTS.WIKI_RESULT: {
      // Must match the client payload shape used by the meeting wiki panel.
      const article = d.article;
      if (!article || typeof article !== "object") return false;
      const r = article as Record<string, unknown>;
      return (
        typeof d.query === "string" && d.query.length > 0 && d.query.length <= 300 &&
        (d.searcherName === undefined || typeof d.searcherName === "string") &&
        typeof r.title === "string" && r.title.length > 0 && r.title.length <= 500 &&
        (r.url === undefined || (typeof r.url === "string" && r.url.length <= 2000)) &&
        (r.description === undefined || (typeof r.description === "string" && r.description.length <= 5000))
      );
    }

    default:
      return false;
  }
}

// Strict IPv4 dotted-quad validation that rejects non-standard forms accepted
// by Node's isIP() such as hex integers ("0x7f000001"), octal integers
// ("017700000001"), or bare decimal integers ("2130706433"). Only the canonical
// dotted-decimal form with numeric octets 0-255 is permitted.
function isStrictIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255;
  });
}

export function isSuspiciousHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return true;
  // Reject bare IP-like strings that don't have dots (e.g. "0x7f000001")
  // and non-standard IP forms. Only standard dotted-quad and IPv6 are allowed.
  if (isIP(normalized) === 4) return !isStrictIpv4(normalized);
  if (isIP(normalized) === 6) return false;
  // Non-IP hostnames must contain at least one dot to be considered valid
  return !normalized.includes(".");
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

/**
 * C5 fix: returns the resolved addresses so callers can pin the connection
 * to the validated IP instead of re-resolving on fetch (TOCTOU prevention).
 */
export async function assertSafeUnfurlTarget(targetUrl: URL): Promise<string[]> {
  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    throw new UnsafeUnfurlTargetError("Only http/https URLs supported");
  }

  const hostname = targetUrl.hostname.trim();
  if (!hostname || isSuspiciousHostname(hostname)) {
    throw new UnsafeUnfurlTargetError("Hostname is not allowed");
  }

  const addresses = await resolveHostAddresses(hostname);
  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
    throw new UnsafeUnfurlTargetError("Resolved address is not public");
  }

  return addresses;
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  // 192.0.0.0/24 only (IANA reserved), not /16
  if (a === 192 && b === 0 && c === 0) return false;
  // TEST-NET-1 (RFC 5737)
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 168) return false;
  // Benchmarking (RFC 2544)
  if (a === 198 && (b === 18 || b === 19)) return false;
  // TEST-NET-2 (198.51.100.0/24) and TEST-NET-3 (203.0.113.0/24) (RFC 5737)
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a >= 224) return false;
  return true;
}

// Normalize IPv6 address to full 8-group form for reliable prefix checks.
function normalizeIPv6(address: string): string | null {
  try {
    const lower = address.toLowerCase().trim();

    // Handle IPv4-mapped like ::ffff:192.168.1.1
    if (lower.includes(".")) {
      const lastColon = lower.lastIndexOf(":");
      const ipv4Part = lower.slice(lastColon + 1);
      const ipv6Prefix = lower.slice(0, lastColon + 1);
      const ipv4Octets = ipv4Part.split(".").map(Number);
      if (ipv4Octets.length !== 4 || ipv4Octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
        return null;
      }
      const hex1 = ((ipv4Octets[0] << 8) | ipv4Octets[1]).toString(16).padStart(4, "0");
      const hex2 = ((ipv4Octets[2] << 8) | ipv4Octets[3]).toString(16).padStart(4, "0");
      return normalizeIPv6(ipv6Prefix + hex1 + ":" + hex2);
    }

    if (!lower.includes("::")) {
      const parts = lower.split(":");
      if (parts.length !== 8) return null;
      return parts.map((p) => p.padStart(4, "0")).join(":");
    }

    const [leftStr, rightStr] = lower.split("::");
    const left = leftStr ? leftStr.split(":") : [];
    const right = rightStr ? rightStr.split(":") : [];
    const missingCount = 8 - left.length - right.length;
    if (missingCount < 0) return null;
    const middle = Array(missingCount).fill("0000");
    const parts = [...left, ...middle, ...right];
    if (parts.length !== 8) return null;
    return parts.map((p) => p.padStart(4, "0")).join(":");
  } catch {
    return null;
  }
}

function isPublicIpv6(address: string): boolean {
  // normalize before prefix checks to handle expanded forms like 0:0:0:0:0:0:0:1
  const normalized = normalizeIPv6(address);
  if (!normalized) return false; // unparseable — reject

  const groups = normalized.split(":");
  if (groups.length !== 8) return false;

  // Loopback ::1 and unspecified ::
  if (normalized === "0000:0000:0000:0000:0000:0000:0000:0001") return false;
  if (normalized === "0000:0000:0000:0000:0000:0000:0000:0000") return false;

  const g0 = parseInt(groups[0], 16);
  const g1 = parseInt(groups[1], 16);

  // ULA: fc00::/7 (first byte 0xfc–0xfd)
  if ((g0 & 0xfe00) === 0xfc00) return false;
  // Link-local: fe80::/10
  if ((g0 & 0xffc0) === 0xfe80) return false;
  // Multicast: ff00::/8
  if ((g0 & 0xff00) === 0xff00) return false;
  // Site-local (deprecated but still block): fec0::/10
  if ((g0 & 0xffc0) === 0xfec0) return false;

  // Documentation: 2001:db8::/32 (must be exact prefix match, not 2001:db80::)
  if (g0 === 0x2001 && g1 === 0x0db8) return false;
  // Teredo: 2001:0000::/32
  if (g0 === 0x2001 && g1 === 0x0000) return false;

  // NAT64: 64:ff9b::/96
  if (g0 === 0x0064 && g1 === 0xff9b) return false;

  // 6to4: 2002::/16 — check the embedded IPv4 for private addresses
  if (g0 === 0x2002) {
    const g2 = parseInt(groups[2], 16);
    const embA = (g1 >> 8) & 0xff;
    const embB = g1 & 0xff;
    const embC = (g2 >> 8) & 0xff;
    if (!isPublicIpv4(`${embA}.${embB}.${embC}.0`)) return false;
  }

  // IPv4-mapped: ::ffff:0:0/96 (groups 0-4 all zero, group 5 = 0xffff)
  // only block IPv4-mapped with private embedded addresses, not all ::ffff:*
  if (
    groups.slice(0, 5).every((g) => g === "0000") &&
    parseInt(groups[5], 16) === 0xffff
  ) {
    const g6 = parseInt(groups[6], 16);
    const g7 = parseInt(groups[7], 16);
    const embA = (g6 >> 8) & 0xff;
    const embB = g6 & 0xff;
    const embC = (g7 >> 8) & 0xff;
    const embD = g7 & 0xff;
    return isPublicIpv4(`${embA}.${embB}.${embC}.${embD}`);
  }

  return true;
}
