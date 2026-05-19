import { beforeEach, describe, expect, it } from "vitest";
import { users, meetingAdmissions, meetingLivekitPresences, meetingSessions, rooms } from "@ossmeet/db/schema";
import { createTestDb, type TestDb } from "@/test/db.ts";
import { getGrantableMeetingParticipant, getOwnedActiveMeetingPresence } from "../screen-share.ts";

let db: TestDb;

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
  const meetingCode = meetingId === "meeting_2" ? "abc-defg-hik" : "abc-defg-hij";
  await db.insert(rooms).values({
    id: `room_${meetingId}`,
    code: meetingCode,
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

async function insertAdmissionWithConnection(opts: {
  admissionId: string;
  meetingId: string;
  userId: string | null;
  livekitIdentity: string | null;
  disconnected?: boolean;
  presenceStatus?: "connected" | "token_issued";
}) {
  const now = new Date();
  await db.insert(meetingAdmissions).values({
    id: opts.admissionId,
    sessionId: opts.meetingId,
    subjectType: opts.userId ? "user" : "guest",
    subjectUserId: opts.userId,
    guestSecretHash: opts.userId ? null : "guest-secret-hash",
    displayName: opts.userId ?? "Guest",
    requestedRole: opts.userId ? "participant" : "guest",
    grantedRole: opts.userId ? "participant" : "guest",
    admissionStatus: "approved",
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (!opts.disconnected) {
    await db.insert(meetingLivekitPresences).values({
      id: `mlp_${opts.admissionId}`,
      sessionId: opts.meetingId,
      admissionId: opts.admissionId,
      livekitIdentity: opts.livekitIdentity ?? opts.userId ?? opts.admissionId,
      livekitParticipantSid: `sid_${opts.admissionId}`,
      userId: opts.userId,
      role: opts.userId ? "participant" : "guest",
      presenceStatus: opts.presenceStatus ?? "connected",
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

describe("getGrantableMeetingParticipant", () => {
  it("resolves an active guest by LiveKit identity", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host");
    await insertAdmissionWithConnection({
      admissionId: "mad_guest",
      meetingId: "meeting_1",
      userId: null,
      livekitIdentity: "guest_livekit_1",
    });

    await expect(
      getGrantableMeetingParticipant(db, "meeting_1", "guest_livekit_1"),
    ).resolves.toMatchObject({
      id: "mad_guest",
      userId: null,
      livekitIdentity: "guest_livekit_1",
    });
  });

  it("resolves an authenticated participant by user identity when the row predates livekitIdentity", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertAdmissionWithConnection({
      admissionId: "mad_member",
      meetingId: "meeting_1",
      userId: "member",
      livekitIdentity: null,
    });

    await expect(
      getGrantableMeetingParticipant(db, "meeting_1", "member"),
    ).resolves.toMatchObject({
      id: "mad_member",
      userId: "member",
      livekitIdentity: "member",
    });
  });

  it("resolves a guest whose connection is still token_issued while the webhook catches up", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host");
    await insertAdmissionWithConnection({
      admissionId: "mad_guest_pending",
      meetingId: "meeting_1",
      userId: null,
      livekitIdentity: "guest_pending_livekit",
      presenceStatus: "token_issued",
    });

    await expect(
      getGrantableMeetingParticipant(db, "meeting_1", "guest_pending_livekit"),
    ).resolves.toMatchObject({
      id: "mad_guest_pending",
      userId: null,
      livekitIdentity: "guest_pending_livekit",
    });
  });

  it("rejects participants that already left the meeting", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host");
    await insertAdmissionWithConnection({
      admissionId: "mad_left",
      meetingId: "meeting_1",
      userId: null,
      livekitIdentity: "guest_left",
      disconnected: true,
    });

    await expect(
      getGrantableMeetingParticipant(db, "meeting_1", "guest_left"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects identities from a different meeting", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host");
    await insertMeeting("meeting_2", "host");
    await insertAdmissionWithConnection({
      admissionId: "mad_other",
      meetingId: "meeting_2",
      userId: null,
      livekitIdentity: "guest_other",
    });

    await expect(
      getGrantableMeetingParticipant(db, "meeting_1", "guest_other"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getOwnedActiveMeetingPresence", () => {
  it("allows an authenticated participant to resolve their own LiveKit presence", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertAdmissionWithConnection({
      admissionId: "mad_member",
      meetingId: "meeting_1",
      userId: "member",
      livekitIdentity: "member_livekit_1",
    });

    await expect(
      getOwnedActiveMeetingPresence(db, {
        meetingId: "meeting_1",
        connectionId: "mlp_mad_member",
        authenticatedUserId: "member",
      }),
    ).resolves.toMatchObject({
      livekitIdentity: "member_livekit_1",
      userId: "member",
    });
  });

  it("rejects attempts to revoke another participant's screen-share grant", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertUser("other");
    await insertMeeting("meeting_1", "host");
    await insertAdmissionWithConnection({
      admissionId: "mad_member",
      meetingId: "meeting_1",
      userId: "member",
      livekitIdentity: "member_livekit_1",
    });

    await expect(
      getOwnedActiveMeetingPresence(db, {
        meetingId: "meeting_1",
        connectionId: "mlp_mad_member",
        authenticatedUserId: "other",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
