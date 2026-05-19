import { describe, expect, it } from "vitest";
import { isSafeInternalRedirect, sanitizeInternalRedirect } from "./safe-redirect";

describe("safe redirect helpers", () => {
  it("allows exact meeting entry URLs", () => {
    expect(isSafeInternalRedirect("/abc-defg-hij")).toBe(true);
    expect(isSafeInternalRedirect("/abc-defg-hij?source=auth#resume")).toBe(true);
  });

  it("rejects non-route meeting path variants", () => {
    expect(isSafeInternalRedirect("/abc-defg-hij/recap")).toBe(false);
    expect(isSafeInternalRedirect("/abc-defg-hij/")).toBe(false);
  });

  it("allows only exact or child matches for internal app sections", () => {
    expect(isSafeInternalRedirect("/dashboard")).toBe(true);
    expect(isSafeInternalRedirect("/dashboard?tab=recent")).toBe(true);
    expect(isSafeInternalRedirect("/dashboard/meeting")).toBe(true);
    expect(isSafeInternalRedirect("/meetings/abc-defg-hij")).toBe(true);
    expect(isSafeInternalRedirect("/dashboarding")).toBe(false);
    expect(isSafeInternalRedirect("/meetings-and-more")).toBe(false);
  });

  it("rejects protocol-relative and external targets", () => {
    expect(isSafeInternalRedirect("//evil.com")).toBe(false);
    expect(sanitizeInternalRedirect("https://evil.com")).toBeUndefined();
  });
});
