import { describe, expect, it } from "vitest";
import {
  addOAuthStateHash,
  hasOAuthStateHash,
  parseOAuthStateCookie,
  removeOAuthStateHash,
} from "../oauth-state";

describe("oauth state cookie helpers", () => {
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const hashC = "c".repeat(64);

  it("parses only valid SHA-256 hex hashes", () => {
    expect(parseOAuthStateCookie(`${hashA}.invalid.${hashB}.xyz`)).toEqual([
      hashA,
      hashB,
    ]);
  });

  it("supports multiple concurrent states and deduplicates repeats", () => {
    const cookie = addOAuthStateHash(addOAuthStateHash(hashA, hashB), hashA);
    expect(parseOAuthStateCookie(cookie)).toEqual([hashB, hashA]);
    expect(hasOAuthStateHash(cookie, hashA)).toBe(true);
    expect(hasOAuthStateHash(cookie, hashC)).toBe(false);
  });

  it("removes only the consumed state and keeps the others", () => {
    const cookie = `${hashA}.${hashB}.${hashC}`;
    expect(removeOAuthStateHash(cookie, hashB)).toBe(`${hashA}.${hashC}`);
  });

  it("keeps only the most recent bounded set of states", () => {
    const values = ["1", "2", "3", "4", "5", "6"].map((char) => char.repeat(64));
    let cookie = "";
    for (const value of values) {
      cookie = addOAuthStateHash(cookie, value);
    }
    expect(parseOAuthStateCookie(cookie)).toEqual(values.slice(-5));
  });
});
