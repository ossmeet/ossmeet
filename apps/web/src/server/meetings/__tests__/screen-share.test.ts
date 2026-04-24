import { beforeEach, describe, expect, it } from "vitest";
import { users, meetingSessions, meetingParticipants, rooms } from "@ossmeet/db/schema";
import { createTestDb, type TestDb } from "@/test/db.ts";
import { getGrantableMeetingParticipant } from "../screen-share.ts";

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

async function insertParticipant(opts: {
  participantId: string;
  meetingId: string;
  userId: string | null;
  livekitIdentity: string | null;
  leftAt?: Date | null;
}) {
  const leftAt = opts.leftAt ?? null;
  await db.insert(meetingParticipants).values({
    id: opts.participantId,
    sessionId: opts.meetingId,
    userId: opts.userId,
    displayName: opts.userId ?? "Guest",
    role: opts.userId ? "participant" : "guest",
    status: leftAt ? "left" : "active",
    livekitIdentity: opts.livekitIdentity,
    guestSecret: opts.userId ? null : "guest-secret-hash",
    joinedAt: new Date(),
    leftAt,
  });
}

describe("getGrantableMeetingParticipant", () => {
  it("resolves an active guest by LiveKit identity", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host");
    await insertParticipant({
      participantId: "prt_guest",
      meetingId: "meeting_1",
      userId: null,
      livekitIdentity: "guest_livekit_1",
    });

    await expect(
      getGrantableMeetingParticipant(db, "meeting_1", "guest_livekit_1"),
    ).resolves.toMatchObject({
      id: "prt_guest",
      userId: null,
      livekitIdentity: "guest_livekit_1",
    });
  });

  it("resolves an authenticated participant by user identity when the row predates livekitIdentity", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertParticipant({
      participantId: "prt_member",
      meetingId: "meeting_1",
      userId: "member",
      livekitIdentity: null,
    });

    await expect(
      getGrantableMeetingParticipant(db, "meeting_1", "member"),
    ).resolves.toMatchObject({
      id: "prt_member",
      userId: "member",
      livekitIdentity: null,
    });
  });

  it("rejects participants that already left the meeting", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host");
    await insertParticipant({
      participantId: "prt_left",
      meetingId: "meeting_1",
      userId: null,
      livekitIdentity: "guest_left",
      leftAt: new Date(),
    });

    await expect(
      getGrantableMeetingParticipant(db, "meeting_1", "guest_left"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects identities from a different meeting", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host");
    await insertMeeting("meeting_2", "host");
    await insertParticipant({
      participantId: "prt_other",
      meetingId: "meeting_2",
      userId: null,
      livekitIdentity: "guest_other",
    });

    await expect(
      getGrantableMeetingParticipant(db, "meeting_1", "guest_other"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
