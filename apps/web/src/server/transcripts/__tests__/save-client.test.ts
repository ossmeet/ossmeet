import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@ossmeet/db";
import { users, meetingSessions, meetingParticipants, rooms } from "@ossmeet/db/schema";
import { createTestDb, type TestDb } from "@/test/db.ts";
import {
  buildTrustedTranscriptRows,
  findActiveMeetingParticipant,
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

async function insertParticipant(opts: {
  participantId: string;
  meetingId: string;
  userId: string;
  leftAt?: Date | null;
}) {
  const leftAt = opts.leftAt ?? null;
  await db.insert(meetingParticipants).values({
    id: opts.participantId,
    sessionId: opts.meetingId,
    userId: opts.userId,
    displayName: opts.userId,
    role: "participant",
    status: leftAt ? "left" : "active",
    livekitIdentity: opts.userId,
    guestSecret: null,
    joinedAt: new Date(),
    leftAt,
  });
}

describe("client transcript persistence", () => {
  it("stores canonical participant identity/name instead of trusting client-supplied values", () => {
    const rows = buildTrustedTranscriptRows(
      "meeting_1",
      {
        id: "ptc_1",
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
    await insertParticipant({
      participantId: "prt_member_active",
      meetingId: "meeting_1",
      userId: "member",
    });

    await expect(
      findActiveMeetingParticipant(getAppDb(), "meeting_1", "member"),
    ).resolves.toMatchObject({
      id: "prt_member_active",
      userId: "member",
      leftAt: null,
    });
  });

  it("does not treat left participants as active", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertParticipant({
      participantId: "prt_member_left",
      meetingId: "meeting_1",
      userId: "member",
      leftAt: new Date(),
    });

    await expect(
      findActiveMeetingParticipant(getAppDb(), "meeting_1", "member"),
    ).resolves.toBeNull();
  });
});
