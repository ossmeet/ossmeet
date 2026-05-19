import { describe, expect, it, vi } from "vitest";
import {
  getMeetingTokenRefreshDelayMs,
  getMeetingTokenRefreshFailureMessage,
  getMeetingTokenRetryDelayMs,
} from "../token-refresh";

describe("getMeetingTokenRefreshDelayMs", () => {
  it("refreshes at 80 percent of ttl for normal token lifetimes", () => {
    expect(getMeetingTokenRefreshDelayMs(600)).toBe(480_000);
  });

  it("still refreshes before expiry for short-lived tokens", () => {
    expect(getMeetingTokenRefreshDelayMs(20)).toBe(5_000);
    expect(getMeetingTokenRefreshDelayMs(45)).toBe(15_000);
  });
});

describe("getMeetingTokenRefreshFailureMessage", () => {
  it("maps ended meetingSessions to a user-facing rejoin message", () => {
    expect(getMeetingTokenRefreshFailureMessage({ code: "NOT_FOUND" })).toBe(
      "Meeting has ended. Please rejoin.",
    );
  });

  it("maps revoked access to a user-facing rejoin message", () => {
    expect(getMeetingTokenRefreshFailureMessage({ code: "FORBIDDEN" })).toBe(
      "Your access to this meeting changed. Please rejoin.",
    );
    expect(getMeetingTokenRefreshFailureMessage({ code: "UNAUTHORIZED" })).toBe(
      "Your access to this meeting changed. Please rejoin.",
    );
  });

  it("returns null for transient or unknown failures", () => {
    expect(getMeetingTokenRefreshFailureMessage(new Error("network"))).toBeNull();
    expect(getMeetingTokenRefreshFailureMessage({ code: "RATE_LIMITED" })).toBeNull();
  });
});

describe("getMeetingTokenRetryDelayMs", () => {
  it("uses exponential backoff with jitter for transient retries", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(getMeetingTokenRetryDelayMs(0)).toBe(5_400);
    expect(getMeetingTokenRetryDelayMs(1)).toBe(10_400);
    expect(getMeetingTokenRetryDelayMs(2)).toBe(20_400);
    randomSpy.mockRestore();
  });

  it("caps retry delays at the maximum window", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(getMeetingTokenRetryDelayMs(99)).toBe(60_000);
    randomSpy.mockRestore();
  });
});
