import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@ossmeet/db";
import { meetingSessions, rooms, users } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test/db.ts";
import { insertRoomAndInitialSession } from "../crud";

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

describe("insertRoomAndInitialSession", () => {
  it("creates the room and initial session when under the plan limit", async () => {
    await insertUser("host");
    const now = new Date();

    await expect(
      insertRoomAndInitialSession(getAppDb(), {
        roomId: "ROOM_1",
        sessionId: "MEETING_SESSION_1",
        code: "abc-defg-hij",
        publicSlug: "2026-05-02-abcd",
        hostId: "host",
        spaceId: null,
        title: "Meeting",
        roomType: "instant",
        allowGuests: true,
        recordingEnabled: false,
        requireApproval: false,
        now,
        maxConcurrentMeetings: 1,
      }),
    ).resolves.toBe(true);

    await expect(db.query.rooms.findFirst({ where: eq(rooms.id, "ROOM_1") })).resolves.toMatchObject({
      id: "ROOM_1",
      hostId: "host",
    });
    await expect(
      db.query.meetingSessions.findFirst({ where: eq(meetingSessions.id, "MEETING_SESSION_1") }),
    ).resolves.toMatchObject({
      id: "MEETING_SESSION_1",
      roomId: "ROOM_1",
      hostId: "host",
      status: "active",
    });
  });

  it("refuses creation without leaving partial rows behind when the limit is reached", async () => {
    await insertUser("host");
    const now = new Date();

    await db.insert(rooms).values({
      id: "ROOM_EXISTING",
      code: "def-ghij-klm",
      type: "instant",
      hostId: "host",
      spaceId: null,
      title: "Existing",
      allowGuests: true,
      recordingEnabled: false,
      requireApproval: false,
      lastUsedAt: now,
      expiresAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(meetingSessions).values({
      id: "MEETING_SESSION_EXISTING",
      roomId: "ROOM_EXISTING",
      publicSlug: "2026-05-02-wxyz",
      title: "Existing",
      hostId: "host",
      spaceId: null,
      status: "active",
      allowGuests: true,
      recordingEnabled: false,
      requireApproval: false,
      locked: false,
      activeEgressId: null,
      startedAt: now,
      endedAt: null,
      retainUntil: null,
      updatedAt: now,
    });

    await expect(
      insertRoomAndInitialSession(getAppDb(), {
        roomId: "ROOM_BLOCKED",
        sessionId: "MEETING_SESSION_BLOCKED",
        code: "mno-pqrs-tuv",
        publicSlug: "2026-05-02-efgh",
        hostId: "host",
        spaceId: null,
        title: "Blocked",
        roomType: "instant",
        allowGuests: true,
        recordingEnabled: false,
        requireApproval: false,
        now,
        maxConcurrentMeetings: 1,
      }),
    ).resolves.toBe(false);

    await expect(db.query.rooms.findFirst({ where: eq(rooms.id, "ROOM_BLOCKED") })).resolves.toBeUndefined();
    await expect(
      db.query.meetingSessions.findFirst({ where: eq(meetingSessions.id, "MEETING_SESSION_BLOCKED") }),
    ).resolves.toBeUndefined();
  });
});
