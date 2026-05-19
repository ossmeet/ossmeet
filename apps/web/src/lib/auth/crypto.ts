// Cloudflare Workers runtime extension for timing-safe comparison
declare global {
  interface SubtleCrypto {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  }
}

const enc = new TextEncoder();

/**
 * Hash OTP with server secret as HMAC key, email as part of the message
 * Uses server-side secret instead of email as the HMAC key
 */
export async function hashOtp(otp: string, email: string, secret: string): Promise<string> {
  if (!secret) {
    throw new Error("AUTH_SECRET is required for OTP hashing");
  }
  const keyMaterial = secret;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  // Include email in the message so OTPs are scoped to specific emails
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${email}:${otp}`));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate 6-digit OTP with rejection sampling for uniform distribution */
export function generateOTP(): string {
  const max = 1_000_000;
  const threshold = Math.floor(0x100000000 / max) * max;
  while (true) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    if (num < threshold) {
      return (num % max).toString().padStart(6, "0");
    }
  }
}

/** Hash session token (SHA-256) */
export async function hashSessionToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate 256-bit session token (64-char hex) */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Timing-safe comparison for hex strings (e.g., HMAC-SHA256 outputs).
 * Always compares the full length to avoid leaking information via timing.
 */
export function timingSafeCompareHex(a: string, b: string): boolean {
  // Pad both inputs to the same length to avoid leaking length via timing.
  // Always perform the full comparison unconditionally before returning.
  const maxLen = Math.max(a.length, b.length);
  const aPadded = a.padEnd(maxLen, "\0");
  const bPadded = b.padEnd(maxLen, "\0");
  const equal = crypto.subtle.timingSafeEqual(enc.encode(aPadded), enc.encode(bPadded));
  // Also enforce length equality — padded strings of different original lengths must not match
  return equal && a.length === b.length;
}

/**
 * Verify a raw guest secret against the stored hash.
 * Hashes the raw secret and compares timing-safely against the stored SHA-256 hash.
 */
export async function verifyGuestSecret(storedHash: string, rawSecret: string): Promise<boolean> {
  const providedHash = await hashSessionToken(rawSecret);
  return timingSafeCompareHex(storedHash, providedHash);
}
