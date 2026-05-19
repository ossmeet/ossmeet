import { describe, expect, it } from "vitest";
import type { PlatformInfo } from "@/lib/platform";
import { getSpeechRecognitionStartupDelayMs } from "./speech-startup";

function platform(overrides: Partial<PlatformInfo>): PlatformInfo {
  return {
    os: "unknown",
    engine: "unknown",
    input: "pointer",
    canHover: true,
    prefersReducedMotion: false,
    isPWA: false,
    isHighDPI: false,
    isMobileViewport: false,
    ...overrides,
  };
}

describe("getSpeechRecognitionStartupDelayMs", () => {
  it("adds a startup cushion on iPadOS to avoid WebKit speech-recognition join races", () => {
    expect(
      getSpeechRecognitionStartupDelayMs(
        platform({ os: "ipados", engine: "webkit", input: "touch" }),
      ),
    ).toBeGreaterThan(0);
  });

  it("does not delay desktop Safari", () => {
    expect(
      getSpeechRecognitionStartupDelayMs(
        platform({ os: "macos", engine: "webkit" }),
      ),
    ).toBe(0);
  });
});
