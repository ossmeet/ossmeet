import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackSource } from "livekit-server-sdk";

const createLiveKitAccessMock = vi.fn();
const buildWhiteboardJoinAccessExtrasMock = vi.fn();

vi.mock("@/lib/meeting/livekit-token.server", () => ({
  createLiveKitAccess: createLiveKitAccessMock,
}));

vi.mock("@whiteboard/server", () => ({
  buildWhiteboardJoinAccessExtras: buildWhiteboardJoinAccessExtrasMock,
}));

describe("meeting access helpers", () => {
  beforeEach(() => {
    createLiveKitAccessMock.mockReset();
    createLiveKitAccessMock.mockResolvedValue({
      token: "token-123",
      turnServers: [],
      expiresIn: 600,
    });
    buildWhiteboardJoinAccessExtrasMock.mockReset();
    buildWhiteboardJoinAccessExtrasMock.mockResolvedValue({});
  });

  it("returns expected publish sources for hosts, moderators, and guests", async () => {
    const { getMeetingRolePublishSources } = await import("../access.server");

    expect(getMeetingRolePublishSources("host")).toEqual([
      TrackSource.CAMERA,
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ]);
    expect(getMeetingRolePublishSources("moderator")).toEqual([
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
      } as unknown as Env,
      meeting: {
        id: "mtg_123",
        title: "Design Review",
        recordingEnabled: true,
        activeEgressId: null,
        activeStreamEgressId: null,
      },
      connectionId: "conn_1",
      admissionId: "participant_1",
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
      connectionId: "conn_1",
      admissionId: "participant_1",
      isHost: true,
      isActingModerator: false,
      participantName: "Atiq",
      participantIdentity: "usr_1",
      meetingTitle: "Design Review",
      turnServers: [],
      expiresIn: 600,
      recordingEnabled: true,
      recordingActive: false,
      activeEgressId: null,
      streamingActive: false,
      activeStreamEgressId: null,
    });
  });

  it("merges addon extras when the hook is present", async () => {
    buildWhiteboardJoinAccessExtrasMock.mockResolvedValue({
      whiteboardEnabled: true,
      whiteboardToken: "wb-token",
      whiteboardUrl: "https://whiteboard.example.com",
    });

    const { issueMeetingAccess } = await import("../access.server");

    const result = await issueMeetingAccess({
      env: {
        LIVEKIT_URL: "wss://livekit.ossmeet.com",
        LIVEKIT_API_KEY: "key",
        LIVEKIT_API_SECRET: "secret",
      } as unknown as Env,
      meeting: {
        id: "mtg_456",
        title: "Addon Test",
        recordingEnabled: false,
        activeEgressId: null,
        activeStreamEgressId: null,
      },
      connectionId: "conn_2",
      admissionId: "participant_2",
      participantIdentity: "usr_2",
      participantName: "Guest",
      participantRole: "participant",
      isHost: false,
      recordingEnabled: false,
    });

    expect(buildWhiteboardJoinAccessExtrasMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meetingId: "mtg_456",
        participantIdentity: "usr_2",
        participantName: "Guest",
        participantRole: "participant",
        connectionId: "conn_2",
      }),
    );

    expect(result.whiteboardEnabled).toBe(true);
    expect(result.whiteboardToken).toBe("wb-token");
    expect(result.whiteboardUrl).toBe("https://whiteboard.example.com");
  });

  it("issues acting moderator access without promoting the whiteboard JWT role to host", async () => {
    const { issueMeetingAccess } = await import("../access.server");

    const result = await issueMeetingAccess({
      env: {
        LIVEKIT_URL: "wss://livekit.ossmeet.com",
        LIVEKIT_API_KEY: "key",
        LIVEKIT_API_SECRET: "secret",
      } as unknown as Env,
      meeting: {
        id: "mtg_789",
        title: "Fallback Host",
        recordingEnabled: true,
        activeEgressId: "recording_1",
        activeStreamEgressId: "stream_1",
      },
      connectionId: "conn_3",
      admissionId: "participant_3",
      participantIdentity: "guest_1",
      participantName: "Guest Moderator",
      participantRole: "host",
      isHost: false,
      isActingModerator: true,
      recordingEnabled: true,
    });

    expect(createLiveKitAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: "guest_1",
        isHost: false,
        metadata: {
          sessionId: "mtg_789",
          meetingId: "mtg_789",
          role: "moderator",
          actingModerator: true,
        },
        canPublishSources: [
          TrackSource.CAMERA,
          TrackSource.MICROPHONE,
          TrackSource.SCREEN_SHARE,
          TrackSource.SCREEN_SHARE_AUDIO,
        ],
      }),
    );
    expect(buildWhiteboardJoinAccessExtrasMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        participantRole: "participant",
      }),
    );
    expect(result.isHost).toBe(false);
    expect(result.isActingModerator).toBe(true);
    expect(result.activeEgressId).toBeNull();
    expect(result.activeStreamEgressId).toBeNull();
  });
});
