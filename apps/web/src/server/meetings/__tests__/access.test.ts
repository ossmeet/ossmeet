import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackSource } from "livekit-server-sdk";

const createLiveKitAccessMock = vi.fn();

vi.mock("@/lib/meeting/livekit-token.server", () => ({
  createLiveKitAccess: createLiveKitAccessMock,
}));

describe("meeting access helpers", () => {
  beforeEach(() => {
    createLiveKitAccessMock.mockReset();
    createLiveKitAccessMock.mockResolvedValue({
      token: "token-123",
      turnServers: [],
      expiresIn: 600,
    });
  });

  it("returns expected publish sources for hosts and guests", async () => {
    const { getMeetingRolePublishSources } = await import("../access.server");

    expect(getMeetingRolePublishSources("host")).toEqual([
      TrackSource.CAMERA,
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ]);
    expect(getMeetingRolePublishSources("guest")).toEqual([
      TrackSource.CAMERA,
      TrackSource.MICROPHONE,
    ]);
  });

  it("builds the full meeting access response shape", async () => {
    const { issueMeetingAccess } = await import("../access.server");

    const result = await issueMeetingAccess({
      env: {
        LIVEKIT_URL: "wss://livekit.ossmeet.com",
        LIVEKIT_API_KEY: "key",
        LIVEKIT_API_SECRET: "secret",
        WHITEBOARD_URL: "https://whiteboard.ossmeet.com",
        WHITEBOARD_JWT_SECRET: "whiteboard-secret",
      } as unknown as Env,
      meeting: {
        id: "mtg_123",
        title: "Design Review",
        recordingEnabled: true,
        activeEgressId: null,
      },
      participantId: "participant_1",
      participantIdentity: "usr_1",
      participantName: "Atiq",
      participantRole: "host",
      isHost: true,
      recordingEnabled: true,
    });

    expect(createLiveKitAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: "usr_1",
        roomName: "meet-mtg_123",
        isHost: true,
        canPublishSources: [
          TrackSource.CAMERA,
          TrackSource.MICROPHONE,
          TrackSource.SCREEN_SHARE,
          TrackSource.SCREEN_SHARE_AUDIO,
        ],
      }),
    );

    expect(result).toEqual({
      token: "token-123",
      serverUrl: "wss://livekit.ossmeet.com",
      roomName: "meet-mtg_123",
      sessionId: "mtg_123",
      meetingId: "mtg_123",
      participantId: "participant_1",
      isHost: true,
      participantName: "Atiq",
      participantIdentity: "usr_1",
      meetingTitle: "Design Review",
      turnServers: [],
      expiresIn: 600,
      whiteboardEnabled: true,
      whiteboardDisabledReason: null,
      whiteboardToken: expect.any(String),
      whiteboardUrl: "https://whiteboard.ossmeet.com",
      recordingEnabled: true,
      recordingActive: false,
      activeEgressId: null,
    });
  });

  it("disables whiteboard access when whiteboard JWT is not configured", async () => {
    const { issueMeetingAccess } = await import("../access.server");

    const result = await issueMeetingAccess({
      env: {
        LIVEKIT_URL: "wss://livekit.ossmeet.com",
        LIVEKIT_API_KEY: "key",
        LIVEKIT_API_SECRET: "secret",
        WHITEBOARD_URL: "https://whiteboard.ossmeet.com",
        WHITEBOARD_JWT_SECRET: "",
      } as unknown as Env,
      meeting: {
        id: "mtg_456",
        title: "No Whiteboard Secret",
        recordingEnabled: false,
        activeEgressId: null,
      },
      participantId: "participant_2",
      participantIdentity: "usr_2",
      participantName: "Guest",
      participantRole: "participant",
      isHost: false,
      recordingEnabled: false,
    });

    expect(result.whiteboardEnabled).toBe(false);
    expect(result.whiteboardDisabledReason).toBe("Whiteboard authentication is not configured.");
    expect(result.whiteboardToken).toBeNull();
    expect(result.whiteboardUrl).toBeNull();
  });
});
