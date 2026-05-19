import { describe, expect, it } from "vitest";
import {
  AUTO_GENERATION_MAX_ATTEMPTS,
  autoGenerationRetryDelay,
  shouldPollForSummary,
  shouldRetryGenerationError,
} from "./generation-policy";

describe("meeting recap generation policy", () => {
  it("retries only transient generation errors while attempts remain", () => {
    expect(shouldRetryGenerationError("no_transcript", 0)).toBe(true);
    expect(shouldRetryGenerationError("meeting_not_ended", 0)).toBe(true);
    expect(shouldRetryGenerationError("llm_failed", 0)).toBe(false);
    expect(shouldRetryGenerationError("ai_not_configured", 0)).toBe(false);
  });

  it("does not retry transient generation errors after the final attempt", () => {
    expect(shouldRetryGenerationError("no_transcript", AUTO_GENERATION_MAX_ATTEMPTS - 1)).toBe(false);
    expect(shouldRetryGenerationError("meeting_not_ended", AUTO_GENERATION_MAX_ATTEMPTS - 1)).toBe(false);
  });

  it("polls only while a session has no summary and generation has not reached a terminal state", () => {
    expect(shouldPollForSummary({
      hasSession: true,
      hasSummary: false,
      generationError: null,
      attempt: 0,
    })).toBe(true);

    expect(shouldPollForSummary({
      hasSession: true,
      hasSummary: false,
      generationError: "llm_failed",
      attempt: 0,
    })).toBe(false);

    expect(shouldPollForSummary({
      hasSession: true,
      hasSummary: false,
      generationError: null,
      attempt: AUTO_GENERATION_MAX_ATTEMPTS,
    })).toBe(false);
  });

  it("uses exponential backoff capped at 10s", () => {
    expect(autoGenerationRetryDelay(0)).toBe(2_000);
    expect(autoGenerationRetryDelay(1)).toBe(5_000);
    expect(autoGenerationRetryDelay(2)).toBe(10_000);
    expect(autoGenerationRetryDelay(99)).toBe(10_000);
  });
});

