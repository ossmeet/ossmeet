import { describe, expect, it } from "vitest";
import {
  getInitials,
  getRecorderAvatarParticipants,
  getRecorderGridColumnCount,
  isActiveRecorderVideoTrack,
  isRecorderStartupBlockedByWhiteboard,
  shouldMountRecorderWhiteboard,
  shouldWaitForRecorderWhiteboard,
} from "./recorder-layout";

describe("shouldMountRecorderWhiteboard", () => {
  it("keeps the whiteboard mounted while it is still loading", () => {
    expect(
      shouldMountRecorderWhiteboard({
        hasWhiteboard: true,
        stage: "whiteboard",
        wbStatus: "loading",
      }),
    ).toBe(true);
  });

  it("keeps the whiteboard mounted once it is ready", () => {
    expect(
      shouldMountRecorderWhiteboard({
        hasWhiteboard: true,
        stage: "whiteboard",
        wbStatus: "ready",
      }),
    ).toBe(true);
  });

  it("falls back to video-only layout when the whiteboard errors", () => {
    expect(
      shouldMountRecorderWhiteboard({
        hasWhiteboard: true,
        stage: "whiteboard",
        wbStatus: "error",
      }),
    ).toBe(false);
  });

  it("uses video-only layout when no whiteboard credentials were provided", () => {
    expect(
      shouldMountRecorderWhiteboard({
        hasWhiteboard: false,
        stage: "whiteboard",
        wbStatus: "loading",
      }),
    ).toBe(false);
  });

  it("uses video-only layout when the meeting stage is video", () => {
    expect(
      shouldMountRecorderWhiteboard({
        hasWhiteboard: true,
        stage: "video",
        wbStatus: "ready",
      }),
    ).toBe(false);
  });

  it("uses screen-share/video layout when screen share is the meeting stage", () => {
    expect(
      shouldMountRecorderWhiteboard({
        hasWhiteboard: true,
        stage: "screen_share",
        wbStatus: "ready",
      }),
    ).toBe(false);
  });
});

describe("isRecorderStartupBlockedByWhiteboard", () => {
  it("blocks startup only while active whiteboard is loading", () => {
    expect(
      isRecorderStartupBlockedByWhiteboard({
        hasWhiteboard: true,
        stage: "whiteboard",
        wbStatus: "loading",
        wbTimedOut: false,
      }),
    ).toBe(true);

    expect(
      isRecorderStartupBlockedByWhiteboard({
        hasWhiteboard: true,
        stage: "whiteboard",
        wbStatus: "ready",
        wbTimedOut: false,
      }),
    ).toBe(false);

    expect(
      isRecorderStartupBlockedByWhiteboard({
        hasWhiteboard: true,
        stage: "whiteboard",
        wbStatus: "error",
        wbTimedOut: false,
      }),
    ).toBe(false);
  });

  it("does not block startup for screen share or video stages", () => {
    expect(
      isRecorderStartupBlockedByWhiteboard({
        hasWhiteboard: true,
        stage: "screen_share",
        wbStatus: "loading",
        wbTimedOut: false,
      }),
    ).toBe(false);

    expect(
      isRecorderStartupBlockedByWhiteboard({
        hasWhiteboard: true,
        stage: "video",
        wbStatus: "loading",
        wbTimedOut: false,
      }),
    ).toBe(false);
  });

  it("does not block startup after timeout", () => {
    expect(
      isRecorderStartupBlockedByWhiteboard({
        hasWhiteboard: true,
        stage: "whiteboard",
        wbStatus: "loading",
        wbTimedOut: true,
      }),
    ).toBe(false);
  });
});

describe("shouldWaitForRecorderWhiteboard", () => {
  it("waits only when the active stage is whiteboard", () => {
    expect(
      shouldWaitForRecorderWhiteboard({
        hasWhiteboard: true,
        stage: "whiteboard",
      }),
    ).toBe(true);

    expect(
      shouldWaitForRecorderWhiteboard({
        hasWhiteboard: true,
        stage: "screen_share",
      }),
    ).toBe(false);

    expect(
      shouldWaitForRecorderWhiteboard({
        hasWhiteboard: true,
        stage: "video",
      }),
    ).toBe(false);
  });

  it("does not wait when recorder has no whiteboard credentials", () => {
    expect(
      shouldWaitForRecorderWhiteboard({
        hasWhiteboard: false,
        stage: "whiteboard",
      }),
    ).toBe(false);
  });
});

describe("isActiveRecorderVideoTrack", () => {
  it("keeps screen shares active even when LiveKit reports them as muted", () => {
    expect(
      isActiveRecorderVideoTrack({
        participantIdentity: "presenter",
        source: "screen_share",
        isMuted: true,
      }),
    ).toBe(true);
  });

  it("hides muted camera tracks so the participant can fall back to an avatar tile", () => {
    expect(
      isActiveRecorderVideoTrack({
        participantIdentity: "guest",
        source: "camera",
        isMuted: true,
      }),
    ).toBe(false);

    expect(
      isActiveRecorderVideoTrack({
        participantIdentity: "guest",
        source: "camera",
        isMuted: false,
      }),
    ).toBe(true);
  });
});

describe("getRecorderAvatarParticipants", () => {
  it("includes camera-off guests and excludes the recorder bot plus active video participants", () => {
    const avatars = getRecorderAvatarParticipants({
      localParticipantIdentity: "egress_bot",
      participants: [
        { identity: "egress_bot", name: "Recorder" },
        { identity: "host", name: "Host" },
        { identity: "muted_guest", name: "gg" },
        { identity: "screen_guest", name: "Screen" },
      ],
      activeVideoTracks: [
        { participantIdentity: "host", source: "camera", isMuted: false },
        { participantIdentity: "muted_guest", source: "camera", isMuted: true },
        { participantIdentity: "screen_guest", source: "screen_share", isMuted: true },
      ],
    });

    expect(avatars).toEqual([{ identity: "muted_guest", name: "gg" }]);
  });

  it("sorts avatar participants by display name when multiple people have no active video", () => {
    const avatars = getRecorderAvatarParticipants({
      localParticipantIdentity: "egress_bot",
      participants: [
        { identity: "z_identity", name: "Zed" },
        { identity: "a_identity", name: "Mina" },
        { identity: "b_identity", name: "Ada" },
      ],
      activeVideoTracks: [],
    });

    expect(avatars.map((participant) => participant.identity)).toEqual([
      "b_identity",
      "a_identity",
      "z_identity",
    ]);
  });
});

describe("getRecorderGridColumnCount", () => {
  it("keeps small grids readable and caps larger grids at three columns", () => {
    expect(getRecorderGridColumnCount(0)).toBe(1);
    expect(getRecorderGridColumnCount(1)).toBe(1);
    expect(getRecorderGridColumnCount(2)).toBe(2);
    expect(getRecorderGridColumnCount(4)).toBe(2);
    expect(getRecorderGridColumnCount(5)).toBe(3);
  });
});

describe("getInitials", () => {
  it("uses first and last initials with a fallback for empty names", () => {
    expect(getInitials("gg")).toBe("G");
    expect(getInitials("Atiq Rahman")).toBe("AR");
    expect(getInitials("  ")).toBe("?");
  });
});
