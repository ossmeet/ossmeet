import { describe, expect, it } from "vitest";
import { buildDays } from "@/server/uptimerobot";

describe("buildDays", () => {
  it("calculates partial uptime for the monitor creation day instead of marking it as no data", () => {
    const day = "2026-04-20";
    const createDatetime = Date.parse("2026-04-20T12:00:00.000Z") / 1000;
    const logs = [
      {
        type: 1,
        datetime: Date.parse("2026-04-20T18:00:00.000Z") / 1000,
        duration: 60 * 60,
      },
    ];

    const [result] = buildDays(
      logs,
      [day],
      createDatetime,
      Date.parse("2026-04-21T00:00:00.000Z"),
    );

    expect(result.hasIncident).toBe(true);
    expect(result.uptimePct).toBeCloseTo(91.6667, 3);
  });

  it("uses elapsed time for today instead of a full-day denominator", () => {
    const day = "2026-04-23";
    const nowMs = Date.parse("2026-04-23T12:00:00.000Z");
    const createDatetime = Date.parse("2026-04-22T00:00:00.000Z") / 1000;
    const logs = [
      {
        type: 1,
        datetime: Date.parse("2026-04-23T11:00:00.000Z") / 1000,
        duration: 30 * 60,
      },
    ];

    const [result] = buildDays(logs, [day], createDatetime, nowMs);

    expect(result.hasIncident).toBe(true);
    expect(result.uptimePct).toBeCloseTo(95.8333, 3);
  });
});
