import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@ossmeet/db";
import { users, meetingAdmissions, meetingLivekitPresences, meetingSessions, rooms, spaces, spaceMembers } from "@ossmeet/db/schema";
import { createTestDb, type TestDb } from "@/test/db.ts";
import {
  buildTrustedTranscriptRows,
  findActiveGuestMeetingParticipant,
  findActiveMeetingParticipant,
  findActiveMeetingParticipantWithSpaceAccess,
} from "../save-client.ts";

let db: TestDb;
const getAppDb = () => db as unknown as Database;

beforeEach(async () => {
  db = await createTestDb();
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
    updatedAt: now,
  });
}

async function insertSpace(spaceId: string, ownerId: string) {
  const now = new Date();
  await db.insert(spaces).values({
    id: spaceId,
    name: "Space",
    description: null,
    slug: `space-${spaceId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
    ownerId,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertMeetingInSpace(meetingId: string, hostId: string, spaceId: string) {
  const now = new Date();
  await db.insert(rooms).values({
    id: `room_${meetingId}`,
    code: "abc-defg-hij",
    hostId,
    spaceId,
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
    spaceId,
    title: "Meeting",
    status: "active",
    allowGuests: true,
    recordingEnabled: false,
    startedAt: now,
    endedAt: null,
    updatedAt: now,
  });
}

async function insertMembership(spaceId: string, userId: string, role: "owner" | "admin" | "member") {
  await db.insert(spaceMembers).values({
    id: `mbr_${spaceId}_${userId}`,
    spaceId,
    userId,
    role,
    joinedAt: new Date(),
  });
}

async function insertAdmissionWithConnection(opts: {
  admissionId: string;
  meetingId: string;
  userId: string | null;
  connected?: boolean;
  role?: "host" | "participant" | "guest";
  displayName?: string;
  livekitIdentity?: string;
}) {
  const connected = opts.connected ?? true;
  const role = opts.role ?? (opts.userId ? "participant" : "guest");
  const now = new Date();
  await db.insert(meetingAdmissions).values({
    id: opts.admissionId,
    sessionId: opts.meetingId,
    subjectType: opts.userId ? "user" : "guest",
    subjectUserId: opts.userId,
    guestSecretHash: opts.userId ? null : "guest_secret_hash",
    displayName: opts.displayName ?? opts.userId ?? "Guest",
    requestedRole: role,
    grantedRole: role,
    admissionStatus: "approved",
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (connected) {
    await db.insert(meetingLivekitPresences).values({
      id: `mlp_${opts.admissionId}`,
      sessionId: opts.meetingId,
      admissionId: opts.admissionId,
      livekitIdentity: opts.livekitIdentity ?? opts.userId ?? `guest_${opts.admissionId}`,
      livekitParticipantSid: `sid_${opts.admissionId}`,
      userId: opts.userId,
      role,
      presenceStatus: "connected",
      disconnectReason: null,
      tokenIssuedAt: now,
      connectedAt: now,
      disconnectedAt: null,
      lastWebhookAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
}

describe("client transcript persistence", () => {
  it("stores canonical participant identity/name instead of trusting client-supplied values", () => {
    const rows = buildTrustedTranscriptRows(
      "meeting_1",
      {
        admissionId: "mad_1",
        connectionId: "mlp_1",
        displayName: "Real Name",
        livekitIdentity: "livekit_real_identity",
        userId: "user_1",
      },
      "user_1",
      [
        {
          text: "forged content",
          startedAt: 1_700_000_000_000,
        },
      ],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.participantIdentity).toBe("livekit_real_identity");
    expect(rows[0]?.participantName).toBe("Real Name");
  });

  it("finds active participant rows only", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertAdmissionWithConnection({
      admissionId: "mad_member_active",
      meetingId: "meeting_1",
      userId: "member",
    });

    await expect(
      findActiveMeetingParticipant(getAppDb(), "meeting_1", "member"),
    ).resolves.toMatchObject({
      admissionId: "mad_member_active",
      userId: "member",
    });
  });

  it("does not treat left participants as active", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertAdmissionWithConnection({
      admissionId: "mad_member_left",
      meetingId: "meeting_1",
      userId: "member",
      connected: false,
    });

    await expect(
      findActiveMeetingParticipant(getAppDb(), "meeting_1", "member"),
    ).resolves.toBeNull();
  });

  it("requires current space membership for transcript saves in space meetings", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertSpace("space_1", "host");
    await insertMembership("space_1", "host", "owner");
    await insertMeetingInSpace("meeting_1", "host", "space_1");
    await insertAdmissionWithConnection({
      admissionId: "mad_member_active",
      meetingId: "meeting_1",
      userId: "member",
    });

    await expect(
      findActiveMeetingParticipantWithSpaceAccess(getAppDb(), "meeting_1", "member"),
    ).resolves.toBeNull();
  });

  it("allows transcript saves for active space members in space meetings", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertSpace("space_1", "host");
    await insertMembership("space_1", "host", "owner");
    await insertMembership("space_1", "member", "member");
    await insertMeetingInSpace("meeting_1", "host", "space_1");
    await insertAdmissionWithConnection({
      admissionId: "mad_member_active",
      meetingId: "meeting_1",
      userId: "member",
    });

    await expect(
      findActiveMeetingParticipantWithSpaceAccess(getAppDb(), "meeting_1", "member"),
    ).resolves.toMatchObject({
      admissionId: "mad_member_active",
      userId: "member",
    });
  });

  it("resolves active guest participants by verified admission and connection", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host");
    await insertAdmissionWithConnection({
      admissionId: "mad_guest_active",
      meetingId: "meeting_1",
      userId: null,
      displayName: "Guest Speaker",
      livekitIdentity: "guest_livekit_identity",
    });

    await expect(
      findActiveGuestMeetingParticipant(
        getAppDb(),
        "meeting_1",
        "mad_guest_active",
        "mlp_mad_guest_active",
      ),
    ).resolves.toMatchObject({
      admissionId: "mad_guest_active",
      connectionId: "mlp_mad_guest_active",
      displayName: "Guest Speaker",
      livekitIdentity: "guest_livekit_identity",
      userId: null,
    });
  });

  it("does not resolve a guest through a mismatched connection", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host");
    await insertAdmissionWithConnection({
      admissionId: "mad_guest_active",
      meetingId: "meeting_1",
      userId: null,
    });

    await expect(
      findActiveGuestMeetingParticipant(
        getAppDb(),
        "meeting_1",
        "mad_guest_active",
        "wrong_connection",
      ),
    ).resolves.toBeNull();
  });
});
