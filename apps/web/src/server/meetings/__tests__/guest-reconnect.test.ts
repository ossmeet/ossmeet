import { describe, expect, it } from "vitest";
import {
  isRecoverableTerminalGuestReconnect,
  shouldPreserveGuestCookieOnPendingLeave,
} from "../guest-reconnect";

describe("guest reconnect recovery", () => {
  const now = new Date("2026-05-03T11:31:30.000Z");

  it("preserves the guest cookie for a short-lived pending leave", () => {
    expect(
      shouldPreserveGuestCookieOnPendingLeave(
        {
          userId: null,
          status: "pending",
          joinedAt: new Date("2026-05-03T11:31:05.000Z"),
          leftAt: null,
        },
        now,
      ),
    ).toBe(true);
  });

  it("does not preserve the guest cookie once the pending row is too old", () => {
    expect(
      shouldPreserveGuestCookieOnPendingLeave(
        {
          userId: null,
          status: "pending",
          joinedAt: new Date("2026-05-03T11:29:45.000Z"),
          leftAt: null,
        },
        now,
      ),
    ).toBe(false);
  });

  it("allows reclaiming a recent aborted guest join", () => {
    expect(
      isRecoverableTerminalGuestReconnect(
        {
          userId: null,
          status: "aborted",
          joinedAt: new Date("2026-05-03T11:30:27.000Z"),
          leftAt: new Date("2026-05-03T11:30:43.000Z"),
        },
        now,
      ),
    ).toBe(true);
  });

  it("allows reclaiming a recent client-cleaned left guest join", () => {
    expect(
      isRecoverableTerminalGuestReconnect(
        {
          userId: null,
          status: "left",
          joinedAt: new Date("2026-05-03T11:30:50.000Z"),
          leftAt: new Date("2026-05-03T11:31:00.000Z"),
        },
        now,
      ),
    ).toBe(true);
  });

  it("rejects terminal guest rows outside the reconnect grace window", () => {
    expect(
      isRecoverableTerminalGuestReconnect(
        {
          userId: null,
          status: "aborted",
          joinedAt: new Date("2026-05-03T11:27:30.000Z"),
          leftAt: new Date("2026-05-03T11:27:45.000Z"),
        },
        now,
      ),
    ).toBe(false);
  });

  it("rejects terminal rows that belonged to authenticated users", () => {
    expect(
      isRecoverableTerminalGuestReconnect(
        {
          userId: "usr_123",
          status: "aborted",
          joinedAt: new Date("2026-05-03T11:30:27.000Z"),
          leftAt: new Date("2026-05-03T11:30:43.000Z"),
        },
        now,
      ),
    ).toBe(false);
  });
});
