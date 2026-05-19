import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { meetingAdmissions, meetingLivekitPresences, meetingSessions, rooms, users } from "@ossmeet/db/schema";
import { createTestDb, type TestDb } from "@/test/db.ts";

const updateParticipantMock = vi.fn();

vi.mock("livekit-server-sdk", () => ({
  TrackSource: {
    CAMERA: 1,
    MICROPHONE: 2,
  },
  RoomServiceClient: class {
    updateParticipant = updateParticipantMock;
  },
}));

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  updateParticipantMock.mockReset();
  updateParticipantMock.mockResolvedValue(undefined);
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

async function insertMeetingWithActingHost() {
  const now = new Date();
  await db.insert(rooms).values({
    id: "room_1",
    code: "abc-defg-hij",
    hostId: "original_host",
    spaceId: null,
    title: "Meeting",
    allowGuests: true,
    recordingEnabled: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(meetingSessions).values({
    id: "meeting_1",
    roomId: "room_1",
    publicSlug: "meeting_1",
    hostId: "acting_host",
    spaceId: null,
    title: "Meeting",
    status: "active",
    allowGuests: true,
    recordingEnabled: false,
    startedAt: now,
    endedAt: null,
    activeEgressId: null,
    updatedAt: now,
  });
}

async function insertConnection(input: {
  id: string;
  userId: string;
  role: "host" | "participant";
  status?: "connected" | "token_issued" | "disconnected";
}) {
  const now = new Date();
  await db.insert(meetingAdmissions).values({
    id: `admission_${input.id}`,
    sessionId: "meeting_1",
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
    sessionId: "meeting_1",
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

describe("reclaimRoomHostIfReturning", () => {
  it("restores the original room host and demotes the acting host", async () => {
    const { reclaimRoomHostIfReturning } = await import("../host-reclaim.server");
    await insertUser("original_host");
    await insertUser("acting_host");
    await insertMeetingWithActingHost();
    await insertConnection({ id: "acting_conn", userId: "acting_host", role: "host" });

    const hostId = await reclaimRoomHostIfReturning(
      db,
      {
        LIVEKIT_URL: "wss://livekit.example.com",
        LIVEKIT_API_KEY: "key",
        LIVEKIT_API_SECRET: "secret",
      } as Env,
      "meeting_1",
      "original_host",
      "acting_host",
      "original_host",
    );

    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, "meeting_1"),
      columns: { hostId: true },
    });
    const actingPresence = await db.query.meetingLivekitPresences.findFirst({
      where: eq(meetingLivekitPresences.id, "acting_conn"),
      columns: { role: true },
    });

    expect(hostId).toBe("original_host");
    expect(meeting?.hostId).toBe("original_host");
    expect(actingPresence?.role).toBe("participant");
    expect(updateParticipantMock).toHaveBeenCalledWith(
      "meet-meeting_1",
      "acting_host_identity",
      expect.objectContaining({
        metadata: JSON.stringify({ sessionId: "meeting_1", meetingId: "meeting_1", role: "participant" }),
      }),
    );
  });

  it("does not reclaim for non-original participants", async () => {
    const { reclaimRoomHostIfReturning } = await import("../host-reclaim.server");
    await insertUser("original_host");
    await insertUser("acting_host");
    await insertUser("member");
    await insertMeetingWithActingHost();
    await insertConnection({ id: "acting_conn", userId: "acting_host", role: "host" });

    const hostId = await reclaimRoomHostIfReturning(
      db,
      {} as Env,
      "meeting_1",
      "original_host",
      "acting_host",
      "member",
    );

    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, "meeting_1"),
      columns: { hostId: true },
    });

    expect(hostId).toBe("acting_host");
    expect(meeting?.hostId).toBe("acting_host");
    expect(updateParticipantMock).not.toHaveBeenCalled();
  });
});
