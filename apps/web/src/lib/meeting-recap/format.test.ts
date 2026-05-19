import { describe, expect, it, vi } from "vitest";
import { formatDuration, formatTimeAgo } from "./format";

describe("meeting recap formatting", () => {
  it("formats short and long durations", () => {
    expect(formatDuration(null)).toBe("--");
    expect(formatDuration(30)).toBe("< 1 min");
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(3_900)).toBe("1h 5m");
  });

  it("formats relative recap timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T12:00:00Z"));

    expect(formatTimeAgo(null)).toBe("");
    expect(formatTimeAgo(new Date("2026-05-08T11:59:30Z"))).toBe("just now");
    expect(formatTimeAgo(new Date("2026-05-08T11:45:00Z"))).toBe("15m ago");
    expect(formatTimeAgo(new Date("2026-05-08T09:00:00Z"))).toBe("3h ago");

    vi.useRealTimers();
  });
});

