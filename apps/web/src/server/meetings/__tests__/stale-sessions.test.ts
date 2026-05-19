import { describe, expect, it } from "vitest";
import { getMissingRoomFinalizeReason } from "../stale-sessions";

describe("getMissingRoomFinalizeReason", () => {
  const now = new Date("2026-04-26T12:00:00.000Z");

  it("keeps a recent session alive while it is still within the room-missing grace window", () => {
    expect(
      getMissingRoomFinalizeReason(
        {
          id: "meeting_1",
          startedAt: new Date("2026-04-26T11:58:30.000Z"),
        },
        [],
        now,
      ),
    ).toBeNull();
  });

  it("finalizes a missing-room session with stale active participants quickly", () => {
    expect(
      getMissingRoomFinalizeReason(
        {
          id: "meeting_1",
          startedAt: new Date("2026-04-26T11:40:00.000Z"),
        },
        [
          {
            status: "active",
            joinedAt: new Date("2026-04-26T11:57:00.000Z"),
          },
        ],
        now,
      ),
    ).toBe("missing_livekit_room_active_participants");
  });

  it("waits longer before finalizing pending-only ghost participants", () => {
    expect(
      getMissingRoomFinalizeReason(
        {
          id: "meeting_1",
          startedAt: new Date("2026-04-26T11:40:00.000Z"),
        },
        [
          {
            status: "pending",
            joinedAt: new Date("2026-04-26T11:55:30.000Z"),
          },
        ],
        now,
      ),
    ).toBeNull();

    expect(
      getMissingRoomFinalizeReason(
        {
          id: "meeting_1",
          startedAt: new Date("2026-04-26T11:40:00.000Z"),
        },
        [
          {
            status: "pending",
            joinedAt: new Date("2026-04-26T11:49:30.000Z"),
          },
        ],
        now,
      ),
    ).toBe("missing_livekit_room_stale_pending_participants");
  });

  it("finalizes long-idle empty sessions with no room", () => {
    expect(
      getMissingRoomFinalizeReason(
        {
          id: "meeting_1",
          startedAt: new Date("2026-04-26T10:30:00.000Z"),
        },
        [],
        now,
      ),
    ).toBe("missing_livekit_room_empty_session");
  });
});
