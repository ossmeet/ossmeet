import { describe, expect, it, vi } from "vitest";
import { EgressStatus } from "livekit-server-sdk";
import type { EgressInfo } from "livekit-server-sdk";
import {
  startRoomCompositeEgressWithRecovery,
  waitForEgressStartup,
} from "../egress-startup.server";

function egress(overrides: Partial<EgressInfo>): EgressInfo {
  return {
    egressId: "egress_1",
    status: EgressStatus.EGRESS_STARTING,
    streamResults: [],
    error: "",
    details: "",
    ...overrides,
  } as EgressInfo;
}

describe("waitForEgressStartup", () => {
  it("accepts an active recording egress", async () => {
    const result = await waitForEgressStartup(
      { listEgress: vi.fn() },
      egress({ status: EgressStatus.EGRESS_ACTIVE }),
      { requireStreamOutput: false, timeoutMs: 1, pollMs: 0 },
    );

    expect(result.ok).toBe(true);
  });

  it("accepts an active stream egress before LiveKit has populated stream results", async () => {
    const result = await waitForEgressStartup(
      { listEgress: vi.fn() },
      egress({ status: EgressStatus.EGRESS_ACTIVE, streamResults: [] }),
      { requireStreamOutput: true, timeoutMs: 1, pollMs: 0 },
    );

    expect(result.ok).toBe(true);
  });

  it("rejects a failed stream output", async () => {
    const result = await waitForEgressStartup(
      { listEgress: vi.fn() },
      egress({
        status: EgressStatus.EGRESS_ACTIVE,
        streamResults: [{ status: 2, error: "RTMP authentication failed" }],
      } as Partial<EgressInfo>),
      { requireStreamOutput: true, timeoutMs: 1, pollMs: 0 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("RTMP authentication failed");
  });

  it("polls until the egress becomes active", async () => {
    const listEgress = vi.fn().mockResolvedValue([
      egress({ status: EgressStatus.EGRESS_ACTIVE }),
    ]);

    const result = await waitForEgressStartup(
      { listEgress },
      egress({ status: EgressStatus.EGRESS_STARTING }),
      { requireStreamOutput: false, timeoutMs: 50, pollMs: 0 },
    );

    expect(result.ok).toBe(true);
    expect(listEgress).toHaveBeenCalledWith({ egressId: "egress_1" });
  });

  it("returns a startup failure when LiveKit status polling fails", async () => {
    const result = await waitForEgressStartup(
      { listEgress: vi.fn().mockRejectedValue(new Error("livekit unavailable")) },
      egress({ status: EgressStatus.EGRESS_STARTING }),
      { requireStreamOutput: false, timeoutMs: 50, pollMs: 0 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Could not verify LiveKit egress startup.");
  });
});

describe("startRoomCompositeEgressWithRecovery", () => {
  it("clears the sentinel and stops active room egresses when start throws", async () => {
    const clearStartingState = vi.fn().mockResolvedValue(undefined);
    const stopEgress = vi.fn().mockResolvedValue(undefined);
    const result = await startRoomCompositeEgressWithRecovery({
      roomName: "meet_1",
      logPrefix: "[test]",
      requireStreamOutput: false,
      start: vi.fn().mockRejectedValue(new Error("timeout")),
      egressClient: {
        listEgress: vi.fn().mockResolvedValue([
          egress({ egressId: "active", status: EgressStatus.EGRESS_ACTIVE }),
          egress({ egressId: "complete", status: EgressStatus.EGRESS_COMPLETE }),
        ]),
        stopEgress,
      },
      clearStartingState,
      commitStartedEgress: vi.fn(),
    });

    expect(result).toEqual({ error: "LiveKit egress did not start." });
    expect(stopEgress).toHaveBeenCalledWith("active");
    expect(stopEgress).not.toHaveBeenCalledWith("complete");
    expect(clearStartingState).toHaveBeenCalledOnce();
  });

  it("clears the sentinel and stops the egress when startup verification fails", async () => {
    const clearStartingState = vi.fn().mockResolvedValue(undefined);
    const stopEgress = vi.fn().mockResolvedValue(undefined);
    const result = await startRoomCompositeEgressWithRecovery({
      roomName: "meet_1",
      logPrefix: "[test]",
      requireStreamOutput: true,
      start: vi.fn().mockResolvedValue(egress({ status: EgressStatus.EGRESS_STARTING })),
      egressClient: {
        listEgress: vi.fn().mockResolvedValue([
          egress({
            status: EgressStatus.EGRESS_ACTIVE,
            streamResults: [{ status: 2, error: "RTMP authentication failed" }],
          } as Partial<EgressInfo>),
        ]),
        stopEgress,
      },
      clearStartingState,
      commitStartedEgress: vi.fn(),
    });

    expect(result).toEqual({ error: "RTMP authentication failed" });
    expect(stopEgress).toHaveBeenCalledWith("egress_1");
    expect(clearStartingState).toHaveBeenCalledOnce();
  });

  it("stops the egress when database ownership is lost after LiveKit starts", async () => {
    const stopEgress = vi.fn().mockResolvedValue(undefined);
    const result = await startRoomCompositeEgressWithRecovery({
      roomName: "meet_1",
      logPrefix: "[test]",
      requireStreamOutput: false,
      start: vi.fn().mockResolvedValue(egress({ status: EgressStatus.EGRESS_ACTIVE })),
      egressClient: {
        listEgress: vi.fn(),
        stopEgress,
      },
      clearStartingState: vi.fn(),
      commitStartedEgress: vi.fn().mockResolvedValue(false),
    });

    expect(result).toBeNull();
    expect(stopEgress).toHaveBeenCalledWith("egress_1");
  });

  it("returns the committed egress id when startup and ownership commit succeed", async () => {
    const result = await startRoomCompositeEgressWithRecovery({
      roomName: "meet_1",
      logPrefix: "[test]",
      requireStreamOutput: false,
      start: vi.fn().mockResolvedValue(egress({ status: EgressStatus.EGRESS_ACTIVE })),
      egressClient: {
        listEgress: vi.fn(),
        stopEgress: vi.fn(),
      },
      clearStartingState: vi.fn(),
      commitStartedEgress: vi.fn().mockResolvedValue(true),
    });

    expect(result).toEqual({ egressId: "egress_1" });
  });
});
