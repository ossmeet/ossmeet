import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { rooms, meetingSessions, users } from "@ossmeet/db/schema";
import { createTestDb, type TestDb } from "@/test/db";
import { syncReusableRoomRecordingEnabled } from "../reusable-room-recording";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

async function insertUser(id: string, plan: "free" | "pro" = "free") {
  const now = new Date();
  await db.insert(users).values({
    id,
    name: id,
    email: `${id}@example.com`,
    normalizedEmail: `${id}@example.com`,
    image: null,
    plan,
    role: "user",
    createdAt: now,
    updatedAt: now,
  });
}

async function insertReusableRoom() {
  const now = new Date();

  await db.insert(rooms).values({
    id: "link_1",
    code: "abc-defg-hij",
    hostId: "host",
    spaceId: null,
    title: "Room",
    allowGuests: true,
    recordingEnabled: false,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(meetingSessions).values({
    id: "meeting_1",
    roomId: "link_1",
    publicSlug: "meeting_1",
    hostId: "host",
    spaceId: null,
    title: "Session",
    status: "active",
    allowGuests: true,
    recordingEnabled: false,
    startedAt: now,
    endedAt: null,
    activeEgressId: null,
    updatedAt: now,
  });
}

describe("syncReusableRoomRecordingEnabled", () => {
  it("repairs stale reusable-room recording flags for a pro host", async () => {
    await insertUser("host", "pro");
    await insertReusableRoom();

    const result = await syncReusableRoomRecordingEnabled({
      db,
      link: {
        id: "link_1",
        hostId: "host",
        recordingEnabled: false,
      },
      meeting: {
        id: "meeting_1",
        recordingEnabled: false,
      },
      userId: "host",
      hostPlan: "pro",
    });

    expect(result.recordingEnabled).toBe(true);
    expect(result.changed).toBe(true);

    const [link] = await db
      .select({ recordingEnabled: rooms.recordingEnabled })
      .from(rooms)
      .where(eq(rooms.id, "link_1"));
    const [meeting] = await db
      .select({ recordingEnabled: meetingSessions.recordingEnabled })
      .from(meetingSessions)
      .where(eq(meetingSessions.id, "meeting_1"));

    expect(link?.recordingEnabled).toBe(true);
    expect(meeting?.recordingEnabled).toBe(true);
  });

  it("does not mutate reusable-room recording for non-host joins", async () => {
    await insertUser("host", "pro");
    await insertUser("participant", "pro");
    await insertReusableRoom();

    const result = await syncReusableRoomRecordingEnabled({
      db,
      link: {
        id: "link_1",
        hostId: "host",
        recordingEnabled: false,
      },
      meeting: {
        id: "meeting_1",
        recordingEnabled: false,
      },
      userId: "participant",
      hostPlan: "pro",
    });

    expect(result.recordingEnabled).toBe(false);
    expect(result.changed).toBe(false);

    const [link] = await db
      .select({ recordingEnabled: rooms.recordingEnabled })
      .from(rooms)
      .where(eq(rooms.id, "link_1"));
    const [meeting] = await db
      .select({ recordingEnabled: meetingSessions.recordingEnabled })
      .from(meetingSessions)
      .where(eq(meetingSessions.id, "meeting_1"));

    expect(link?.recordingEnabled).toBe(false);
    expect(meeting?.recordingEnabled).toBe(false);
  });
});
