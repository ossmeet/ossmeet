import { describe, expect, it } from "vitest";
import {
  extractMeetingCodeFromPathname,
  isMeetingCode,
  isMeetingPathname,
} from "./meeting-path";

describe("meeting path helpers", () => {
  it("accepts canonical meeting codes", () => {
    expect(isMeetingCode("abc-defg-hij")).toBe(true);
    expect(isMeetingCode("VYF-fadu-gvw")).toBe(false);
    expect(isMeetingCode("abc-defg-hijx")).toBe(false);
  });

  it("matches only the exact meeting entry pathname", () => {
    expect(isMeetingPathname("/abc-defg-hij")).toBe(true);
    expect(isMeetingPathname("/abc-defg-hij/")).toBe(false);
    expect(isMeetingPathname("/abc-defg-hij/recap")).toBe(false);
    expect(isMeetingPathname("/dashboard/abc-defg-hij")).toBe(false);
  });

  it("extracts the code only from exact meeting paths", () => {
    expect(extractMeetingCodeFromPathname("/abc-defg-hij")).toBe("abc-defg-hij");
    expect(extractMeetingCodeFromPathname("/abc-defg-hij?x=1")).toBeNull();
    expect(extractMeetingCodeFromPathname("/abc-defg-hij/child")).toBeNull();
  });
});
