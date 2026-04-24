import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/db.ts";
import type { Database } from "@ossmeet/db";
import { meetingParticipants, meetingSessions, rooms, spaceMembers, spaces, users } from "@ossmeet/db/schema";
import { canAccessActiveMeetingAssets, canAccessMeetingTranscriptData } from "../access.ts";

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

async function insertSpace(spaceId: string, ownerId: string) {
  const now = new Date();
  // Slug must match CHECK: lowercase a-z, 0-9, hyphen only
  const slug = `space-${spaceId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
  await db.insert(spaces).values({
    id: spaceId,
    name: "Space",
    description: null,
    slug,
    ownerId,
    createdAt: now,
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

async function insertMeeting(meetingId: string, hostId: string, spaceId: string | null, status: "active" | "ended" = "active") {
  const now = new Date();
  await db.insert(rooms).values({
    id: `room_${meetingId}`,
    code: "abc-defg-hij",
    hostId,
    spaceId,
    title: "Meeting",
    allowGuests: false,
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
    status,
    allowGuests: false,
    recordingEnabled: false,
    startedAt: now,
    endedAt: status === "ended" ? now : null,
    updatedAt: now,
  });
}

async function insertParticipant(
  meetingId: string,
  userId: string,
  opts?: { leftAt?: Date | null; role?: "host" | "participant" | "guest" },
) {
  const leftAt = opts?.leftAt ?? null;
  await db.insert(meetingParticipants).values({
    id: `prt_${meetingId}_${userId}`,
    sessionId: meetingId,
    userId,
    displayName: userId,
    role: opts?.role ?? "participant",
    status: leftAt ? "left" : "active",
    livekitIdentity: userId,
    guestSecret: null,
    joinedAt: new Date(),
    leftAt,
  });
}

describe("meeting transcript/asset access", () => {
  it("allows transcript access to a space meeting participant with current membership", async () => {
    await insertUser("host");
    await insertUser("participant");
    await insertSpace("space_1", "host");
    await insertMembership("space_1", "host", "owner");
    await insertMembership("space_1", "participant", "member");
    await insertMeeting("meeting_1", "host", "space_1");
    await insertParticipant("meeting_1", "participant");

    await expect(
      canAccessMeetingTranscriptData(getAppDb(), "meeting_1", "participant"),
    ).resolves.toBe(true);
  });

  it("denies transcript access after space membership has been removed", async () => {
    await insertUser("host");
    await insertUser("participant");
    await insertSpace("space_1", "host");
    await insertMembership("space_1", "host", "owner");
    await insertMeeting("meeting_1", "host", "space_1");
    await insertParticipant("meeting_1", "participant");

    await expect(
      canAccessMeetingTranscriptData(getAppDb(), "meeting_1", "participant"),
    ).resolves.toBe(false);
  });

  it("denies active asset access to participants who have already left", async () => {
    await insertUser("host");
    await insertUser("participant");
    await insertMeeting("meeting_1", "host", null, "active");
    await insertParticipant("meeting_1", "participant", { leftAt: new Date() });

    await expect(
      canAccessActiveMeetingAssets(getAppDb(), "meeting_1", "participant"),
    ).resolves.toBe(false);
  });

  it("allows active asset access to the host of an active meeting", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host", null, "active");

    await expect(
      canAccessActiveMeetingAssets(getAppDb(), "meeting_1", "host"),
    ).resolves.toBe(true);
  });
});
