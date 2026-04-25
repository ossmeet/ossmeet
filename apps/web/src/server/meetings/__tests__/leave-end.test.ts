import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { meetingSessions, meetingParticipants, rooms, users } from "@ossmeet/db/schema";
import { hashSessionToken } from "@/lib/auth/crypto";
import { createTestDb, type TestDb } from "@/test/db";

const removeParticipantMock = vi.fn();
const updateParticipantMock = vi.fn();
const finalizeSessionIfEmptyMock = vi.fn();

vi.mock("livekit-server-sdk", () => ({
  RoomServiceClient: class {
    removeParticipant = removeParticipantMock;
    updateParticipant = updateParticipantMock;
  },
  EgressClient: vi.fn(() => ({})),
  TrackSource: {
    CAMERA: 1,
    MICROPHONE: 2,
    SCREEN_SHARE: 3,
    SCREEN_SHARE_AUDIO: 4,
  },
}));

vi.mock("../session-finalizer", async () => {
  const actual = await vi.importActual<typeof import("../session-finalizer")>("../session-finalizer");
  return {
    ...actual,
    finalizeSessionIfEmpty: finalizeSessionIfEmptyMock,
  };
});

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  removeParticipantMock.mockReset();
  removeParticipantMock.mockResolvedValue(undefined);
  updateParticipantMock.mockReset();
  updateParticipantMock.mockResolvedValue(undefined);
  finalizeSessionIfEmptyMock.mockReset();
  finalizeSessionIfEmptyMock.mockResolvedValue(null);
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

async function insertMeeting(meetingId: string, hostId: string) {
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
    activeEgressId: null,
    updatedAt: now,
  });
}

async function insertParticipant(opts: {
  participantId: string;
  meetingId: string;
  userId: string | null;
  role: "host" | "participant" | "guest";
  livekitIdentity: string;
  guestSecret?: string | null;
}) {
  await db.insert(meetingParticipants).values({
    id: opts.participantId,
    sessionId: opts.meetingId,
    userId: opts.userId,
    displayName: opts.userId ?? "Guest",
    role: opts.role,
    livekitIdentity: opts.livekitIdentity,
    guestSecret: opts.guestSecret ?? null,
    joinedAt: new Date(),
    leftAt: null,
  });
}

function buildEnv(): Env {
  return {
    ENVIRONMENT: "development",
    DB: {} as Env["DB"],
    APP_URL: "http://localhost:3000",
    LIVEKIT_URL: "wss://livekit.example.com",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "secret",
  } as Env;
}

describe("executeLeaveMeeting", () => {
  it("marks a guest participant left when the guest secret matches", async () => {
    const { executeLeaveMeeting } = await import("../leave-end.server");

    await insertUser("host");
    await insertMeeting("meeting_1", "host");

    const guestSecret = "guest-secret";
    await insertParticipant({
      participantId: "participant_guest",
      meetingId: "meeting_1",
      userId: null,
      role: "guest",
      livekitIdentity: "guest_participant_guest",
      guestSecret: await hashSessionToken(guestSecret),
    });

    const result = await executeLeaveMeeting({
      env: buildEnv(),
      db,
      meetingId: "meeting_1",
      participantId: "participant_guest",
      authenticatedUserId: null,
      guestCookieSecret: guestSecret,
      rateLimitKey: "meeting:leave:test-guest",
    });

    expect(result).toEqual({ success: true, found: true });
    expect(removeParticipantMock).toHaveBeenCalledWith(
      "meet-meeting_1",
      "guest_participant_guest",
    );

    const [participant] = await db
      .select({ leftAt: meetingParticipants.leftAt })
      .from(meetingParticipants)
      .where(eq(meetingParticipants.id, "participant_guest"));

    expect(participant?.leftAt).toBeTruthy();
  });

  it("does not mark an authenticated participant left when auth context is missing", async () => {
    const { executeLeaveMeeting } = await import("../leave-end.server");

    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertParticipant({
      participantId: "participant_member",
      meetingId: "meeting_1",
      userId: "member",
      role: "participant",
      livekitIdentity: "member_participant_member",
    });

    const result = await executeLeaveMeeting({
      env: buildEnv(),
      db,
      meetingId: "meeting_1",
      participantId: "participant_member",
      authenticatedUserId: null,
      guestCookieSecret: null,
      rateLimitKey: "meeting:leave:test-auth-missing",
    });

    expect(result).toEqual({ success: true, found: false });
    expect(removeParticipantMock).not.toHaveBeenCalled();

    const [participant] = await db
      .select({ leftAt: meetingParticipants.leftAt })
      .from(meetingParticipants)
      .where(eq(meetingParticipants.id, "participant_member"));

    expect(participant?.leftAt).toBeNull();
  });

  it("promotes the next authenticated participant in LiveKit when the host leaves", async () => {
    const { executeLeaveMeeting } = await import("../leave-end.server");

    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertParticipant({
      participantId: "participant_host",
      meetingId: "meeting_1",
      userId: "host",
      role: "host",
      livekitIdentity: "host_participant_host",
    });
    await insertParticipant({
      participantId: "participant_member",
      meetingId: "meeting_1",
      userId: "member",
      role: "participant",
      livekitIdentity: "member_participant_member",
    });

    const result = await executeLeaveMeeting({
      env: buildEnv(),
      db,
      meetingId: "meeting_1",
      participantId: "participant_host",
      authenticatedUserId: "host",
      guestCookieSecret: null,
      rateLimitKey: "meeting:leave:test-host",
    });

    expect(result).toEqual({ success: true, found: true });
    expect(updateParticipantMock).toHaveBeenCalledWith(
      "meet-meeting_1",
      "member_participant_member",
      expect.objectContaining({
        metadata: JSON.stringify({ meetingId: "meeting_1", role: "host" }),
        permission: expect.objectContaining({
          canPublish: true,
          canPublishData: true,
          canSubscribe: true,
        }),
      }),
    );

    const [meeting] = await db
      .select({ hostId: meetingSessions.hostId })
      .from(meetingSessions)
      .where(eq(meetingSessions.id, "meeting_1"));
    const [participant] = await db
      .select({ role: meetingParticipants.role })
      .from(meetingParticipants)
      .where(eq(meetingParticipants.id, "participant_member"));

    expect(meeting?.hostId).toBe("member");
    expect(participant?.role).toBe("host");
  });

  it("can record a passive leave without realtime teardown or empty finalization", async () => {
    const { executeLeaveMeeting } = await import("../leave-end.server");

    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertParticipant({
      participantId: "participant_host",
      meetingId: "meeting_1",
      userId: "host",
      role: "host",
      livekitIdentity: "host_participant_host",
    });
    await insertParticipant({
      participantId: "participant_member",
      meetingId: "meeting_1",
      userId: "member",
      role: "participant",
      livekitIdentity: "member_participant_member",
    });

    const result = await executeLeaveMeeting({
      env: buildEnv(),
      db,
      meetingId: "meeting_1",
      participantId: "participant_host",
      authenticatedUserId: "host",
      guestCookieSecret: null,
      rateLimitKey: "meeting:leave:test-passive",
      removeFromLiveKit: false,
      promoteSuccessor: false,
      finalizeIfEmpty: false,
    });

    expect(result).toEqual({ success: true, found: true });
    expect(removeParticipantMock).not.toHaveBeenCalled();
    expect(updateParticipantMock).not.toHaveBeenCalled();
    expect(finalizeSessionIfEmptyMock).not.toHaveBeenCalled();

    const [meeting] = await db
      .select({ hostId: meetingSessions.hostId })
      .from(meetingSessions)
      .where(eq(meetingSessions.id, "meeting_1"));
    const [participant] = await db
      .select({ leftAt: meetingParticipants.leftAt })
      .from(meetingParticipants)
      .where(eq(meetingParticipants.id, "participant_host"));

    expect(meeting?.hostId).toBe("host");
    expect(participant?.leftAt).toBeTruthy();
  });
});
