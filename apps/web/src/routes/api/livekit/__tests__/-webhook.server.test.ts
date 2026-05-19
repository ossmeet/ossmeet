import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { meetingAdmissions, meetingLivekitPresences, meetingSessions, rooms, users } from "@ossmeet/db/schema";
import { createTestDb, type TestDb } from "@/test/db.ts";

const getParticipantMock = vi.fn();
const updateRoomMetadataMock = vi.fn();

vi.mock("livekit-server-sdk", () => ({
  EgressStatus: { EGRESS_COMPLETE: 3 },
  TrackSource: {
    CAMERA: 1,
    MICROPHONE: 2,
    SCREEN_SHARE: 3,
    SCREEN_SHARE_AUDIO: 4,
  },
  WebhookReceiver: class {
    receive() {
      throw new Error("not used in these tests");
    }
  },
  EgressClient: class {
    stopEgress = vi.fn();
  },
  RoomServiceClient: class {
    getParticipant = getParticipantMock;
    updateRoomMetadata = updateRoomMetadataMock;
  },
}));

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  getParticipantMock.mockReset();
  updateRoomMetadataMock.mockReset();
  updateRoomMetadataMock.mockResolvedValue(undefined);
});

async function insertUser(id: string) {
  const now = new Date();
  await db.insert(users).values({
    id,
    name: id,
    email: `${id}@example.com`,
    normalizedEmail: `${id}@example.com`,
    image: null,
    plan: "free",
    role: "user",
    createdAt: now,
    updatedAt: now,
  });
}

async function insertMeeting(
  meetingId: string,
  hostId: string,
  activeEgressId: string | null = null,
  activeStreamEgressId: string | null = null,
) {
  const now = new Date();
  await db.insert(rooms).values({
    id: `room_${meetingId}`,
    code: "abc-defg-hij",
    hostId,
    spaceId: null,
    title: "Meeting",
    allowGuests: true,
    recordingEnabled: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(meetingSessions).values({
    id: meetingId,
    roomId: `room_${meetingId}`,
    publicSlug: meetingId,
    hostId,
    spaceId: null,
    title: "Meeting",
    status: "active",
    allowGuests: true,
    recordingEnabled: false,
    startedAt: now,
    endedAt: null,
    activeEgressId,
    activeStreamEgressId,
    updatedAt: now,
  });
}

async function insertConnection(input: {
  id: string;
  meetingId: string;
  userId: string;
  role: "host" | "participant";
  status?: "connected" | "disconnected";
}) {
  const now = new Date();
  await db.insert(meetingAdmissions).values({
    id: `admission_${input.id}`,
    sessionId: input.meetingId,
    subjectType: "user",
    subjectUserId: input.userId,
    guestSecretHash: null,
    displayName: input.userId,
    requestedRole: input.role,
    grantedRole: input.role,
    admissionStatus: "approved",
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(meetingLivekitPresences).values({
    id: input.id,
    sessionId: input.meetingId,
    admissionId: `admission_${input.id}`,
    livekitIdentity: `${input.userId}_identity`,
    livekitParticipantSid: `sid_${input.id}`,
    userId: input.userId,
    role: input.role,
    presenceStatus: input.status ?? "connected",
    disconnectReason: null,
    tokenIssuedAt: now,
    connectedAt: now,
    disconnectedAt: null,
    lastWebhookAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

describe("handleLivekitWebhookEvent", () => {
  it("promotes a successor when a host leaves through LiveKit webhook", async () => {
    const { handleLivekitWebhookEvent } = await import("../-webhook.server");
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertConnection({ id: "host_conn", meetingId: "meeting_1", userId: "host", role: "host" });
    await insertConnection({ id: "member_conn", meetingId: "meeting_1", userId: "member", role: "participant" });
    getParticipantMock.mockRejectedValue({ status: 404, message: "not found" });
    const promoteHost = vi.fn().mockResolvedValue(undefined);

    await handleLivekitWebhookEvent(
      {
        event: "participant_left",
        room: { name: "meet-meeting_1" },
        participant: { identity: "host_identity", sid: "sid_host_conn" },
      } as never,
      { LIVEKIT_URL: "wss://livekit.example.com", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret" } as Env,
      { db, promotionServices: { promoteHost } },
    );

    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, "meeting_1"),
      columns: { hostId: true },
    });
    const memberPresence = await db.query.meetingLivekitPresences.findFirst({
      where: eq(meetingLivekitPresences.id, "member_conn"),
      columns: { role: true },
    });

    expect(promoteHost).toHaveBeenCalledWith(expect.anything(), "meeting_1", "member_identity");
    expect(meeting?.hostId).toBe("host");
    expect(memberPresence?.role).toBe("host");
  });

  it("clears active egress state when a completed recording has invalid metadata", async () => {
    const { handleLivekitWebhookEvent } = await import("../-webhook.server");
    await insertUser("host");
    await insertMeeting("meeting_1", "host", "egress_1");

    await handleLivekitWebhookEvent(
      {
        event: "egress_ended",
        egressInfo: {
          roomName: "meet-meeting_1",
          egressId: "egress_1",
          status: 3,
          fileResults: [{ filename: "recordings/meeting_1.mp4", size: 0n }],
        },
      } as never,
      { LIVEKIT_URL: "wss://livekit.example.com", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret" } as Env,
      { db },
    );

    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, "meeting_1"),
      columns: { activeEgressId: true },
    });

    expect(meeting?.activeEgressId).toBeNull();
    expect(updateRoomMetadataMock).toHaveBeenCalledWith(
      "meet-meeting_1",
      JSON.stringify({ egressMode: null }),
    );
  });

  it("handles stream egress_ended webhook arriving after stopStreamingTask already cleared DB", async () => {
    const { handleLivekitWebhookEvent } = await import("../-webhook.server");
    await insertUser("host");
    // activeStreamEgressId is null — already cleared by stopStreamingTask
    await insertMeeting("meeting_1", "host", null, null);

    await handleLivekitWebhookEvent(
      {
        event: "egress_ended",
        egressInfo: {
          roomName: "meet-meeting_1",
          egressId: "stream_egress_1",
          status: 3, // EGRESS_COMPLETE
          fileResults: [], // streaming egresses never produce file output
        },
      } as never,
      { LIVEKIT_URL: "wss://livekit.example.com", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret" } as Env,
      { db },
    );

    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, "meeting_1"),
      columns: { activeEgressId: true, activeStreamEgressId: true },
    });

    // DB untouched — both were already null
    expect(meeting?.activeEgressId).toBeNull();
    expect(meeting?.activeStreamEgressId).toBeNull();
    // Defensive metadata clear still fires
    expect(updateRoomMetadataMock).toHaveBeenCalledWith(
      "meet-meeting_1",
      JSON.stringify({ egressMode: null }),
    );
  });

  it("clears active stream egress state when a stream egress ends", async () => {
    const { handleLivekitWebhookEvent } = await import("../-webhook.server");
    await insertUser("host");
    await insertMeeting("meeting_1", "host", null, "stream_egress_1");

    await handleLivekitWebhookEvent(
      {
        event: "egress_ended",
        egressInfo: {
          roomName: "meet-meeting_1",
          egressId: "stream_egress_1",
          status: 3,
          fileResults: [],
        },
      } as never,
      { LIVEKIT_URL: "wss://livekit.example.com", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret" } as Env,
      { db },
    );

    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, "meeting_1"),
      columns: { activeStreamEgressId: true },
    });

    expect(meeting?.activeStreamEgressId).toBeNull();
    expect(updateRoomMetadataMock).toHaveBeenCalledWith(
      "meet-meeting_1",
      JSON.stringify({ egressMode: null }),
    );
  });
});
