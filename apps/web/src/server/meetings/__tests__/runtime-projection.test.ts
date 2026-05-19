import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { meetingAdmissions, meetingLivekitPresences, meetingSessions, rooms, users } from "@ossmeet/db/schema";
import { createTestDb, type TestDb } from "@/test/db.ts";
import { ensureMeetingAdmission, upsertMeetingLivekitPresence } from "../runtime-projection";

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

async function insertAdmission(id: string, meetingId: string, userId: string | null, role: "host" | "participant" | "guest") {
  const now = new Date("2026-01-01T00:00:00.000Z");
  await db.insert(meetingAdmissions).values({
    id,
    sessionId: meetingId,
    subjectType: userId ? "user" : "guest",
    subjectUserId: userId,
    guestSecretHash: userId ? null : "guest_secret_hash_hash",
    displayName: userId ?? "Guest",
    requestedRole: role,
    grantedRole: role,
    admissionStatus: "approved",
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

describe("ensureMeetingAdmission", () => {
  it("uses a single insert timestamp for immediately approved admissions", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_admission_1", "host");

    const decidedAt = new Date("2026-01-01T00:00:00.000Z");
    const admissionId = await ensureMeetingAdmission(db, {
      sessionId: "meeting_admission_1",
      subjectType: "user",
      subjectUserId: "member",
      displayName: "Member",
      requestedRole: "participant",
      admissionStatus: "approved",
      decidedAt,
    });

    const [row] = await db
      .select({
        decidedAt: meetingAdmissions.decidedAt,
        createdAt: meetingAdmissions.createdAt,
        updatedAt: meetingAdmissions.updatedAt,
      })
      .from(meetingAdmissions)
      .where(eq(meetingAdmissions.id, admissionId));

    expect(row).toEqual({
      decidedAt,
      createdAt: decidedAt,
      updatedAt: decidedAt,
    });
  });
});

describe("upsertMeetingLivekitPresence", () => {
  it("does not demote connected presence when refreshing a LiveKit token", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertAdmission("admission_1", "meeting_1", "member", "participant");

    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const connectedAt = new Date("2026-01-01T00:00:05.000Z");
    await db.insert(meetingLivekitPresences).values({
      id: "connection_1",
      sessionId: "meeting_1",
      admissionId: "admission_1",
      livekitIdentity: "member_participant_1",
      livekitParticipantSid: "PA_connected",
      userId: "member",
      role: "participant",
      presenceStatus: "connected",
      disconnectReason: null,
      tokenIssuedAt: issuedAt,
      connectedAt,
      disconnectedAt: null,
      lastWebhookAt: connectedAt,
      createdAt: issuedAt,
      updatedAt: connectedAt,
    });

    const refreshedAt = new Date("2026-01-01T00:08:00.000Z");
    const connectionId = await upsertMeetingLivekitPresence(db, {
      sessionId: "meeting_1",
      admissionId: "admission_1",
      livekitIdentity: "member_participant_1",
      userId: "member",
      role: "participant",
      presenceStatus: "token_issued",
      now: refreshedAt,
    });

    expect(connectionId).toBe("connection_1");

    const [row] = await db
      .select({
        presenceStatus: meetingLivekitPresences.presenceStatus,
        tokenIssuedAt: meetingLivekitPresences.tokenIssuedAt,
        connectedAt: meetingLivekitPresences.connectedAt,
        disconnectedAt: meetingLivekitPresences.disconnectedAt,
        lastWebhookAt: meetingLivekitPresences.lastWebhookAt,
        updatedAt: meetingLivekitPresences.updatedAt,
      })
      .from(meetingLivekitPresences)
      .where(eq(meetingLivekitPresences.id, "connection_1"));

    expect(row).toMatchObject({
      presenceStatus: "connected",
      tokenIssuedAt: issuedAt,
      connectedAt,
      disconnectedAt: null,
      lastWebhookAt: connectedAt,
      updatedAt: refreshedAt,
    });
  });

  it("refreshes token_issued rows while they are still waiting for the joined webhook", async () => {
    await insertUser("host");
    await insertMeeting("meeting_2", "host");
    await insertAdmission("admission_2", "meeting_2", null, "guest");

    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    await db.insert(meetingLivekitPresences).values({
      id: "connection_2",
      sessionId: "meeting_2",
      admissionId: "admission_2",
      livekitIdentity: "guest_participant_2",
      livekitParticipantSid: null,
      userId: null,
      role: "guest",
      presenceStatus: "token_issued",
      disconnectReason: null,
      tokenIssuedAt: issuedAt,
      connectedAt: null,
      disconnectedAt: null,
      lastWebhookAt: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    });

    const refreshedAt = new Date("2026-01-01T00:00:30.000Z");
    await upsertMeetingLivekitPresence(db, {
      sessionId: "meeting_2",
      admissionId: "admission_2",
      livekitIdentity: "guest_participant_2",
      userId: null,
      role: "guest",
      presenceStatus: "token_issued",
      now: refreshedAt,
    });

    const [row] = await db
      .select({
        presenceStatus: meetingLivekitPresences.presenceStatus,
        tokenIssuedAt: meetingLivekitPresences.tokenIssuedAt,
        connectedAt: meetingLivekitPresences.connectedAt,
        lastWebhookAt: meetingLivekitPresences.lastWebhookAt,
      })
      .from(meetingLivekitPresences)
      .where(eq(meetingLivekitPresences.id, "connection_2"));

    expect(row).toEqual({
      presenceStatus: "token_issued",
      tokenIssuedAt: refreshedAt,
      connectedAt: null,
      lastWebhookAt: null,
    });
  });
});
