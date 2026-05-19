import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { D1_MAX_BOUND_PARAMETERS, ID_PREFIX } from "./constants";

/** Tailwind class merger */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Generate a prefixed ID using crypto.randomUUID */
export function generateId(prefix: keyof typeof ID_PREFIX): string {
  return `${ID_PREFIX[prefix]}${crypto.randomUUID()}`;
}

/** Generate a meeting code in xxx-xxxx-xxx format
 * Uses crypto.getRandomValues() instead of Math.random()
 */
export function generateMeetingCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const threshold = Math.floor(256 / chars.length) * chars.length; // 234
  const pickChar = (): string => {
    while (true) {
      const byte = crypto.getRandomValues(new Uint8Array(1))[0];
      if (byte < threshold) return chars[byte % chars.length];
    }
  };
  const seg = (n: number) =>
    Array.from({ length: n }, () => pickChar()).join("");
  return `${seg(3)}-${seg(4)}-${seg(3)}`;
}

/**
 * Split an array into chunks of at most `size` elements.
 * Use this before passing ID lists to Drizzle `inArray(...)` to avoid
 * exceeding D1's 100-bound-parameter-per-query limit.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("chunk size must be a positive integer");
  }
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Return the maximum number of repeated items that can fit in one D1 statement.
 * Example: an INSERT with 10 bound columns per row can include 10 rows.
 */
export function d1MaxItemsPerStatement(paramsPerItem = 1, reservedParams = 0): number {
  if (!Number.isInteger(paramsPerItem) || paramsPerItem < 1) {
    throw new Error("paramsPerItem must be a positive integer");
  }
  if (!Number.isInteger(reservedParams) || reservedParams < 0) {
    throw new Error("reservedParams must be a nonnegative integer");
  }

  const availableParams = D1_MAX_BOUND_PARAMETERS - reservedParams;
  const maxItems = Math.floor(availableParams / paramsPerItem);
  if (maxItems < 1) {
    throw new Error("D1 statement has no bound-parameter capacity for repeated items");
  }
  return maxItems;
}

/**
 * Chunk arrays for D1 statements based on the number of bound parameters each
 * repeated item contributes, plus any fixed predicates in the same statement.
 */
export function chunkArrayForD1Parameters<T>(
  arr: T[],
  paramsPerItem = 1,
  reservedParams = 0,
): T[][] {
  return chunkArray(arr, d1MaxItemsPerStatement(paramsPerItem, reservedParams));
}

/** Escape HTML to prevent XSS in email templates */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
