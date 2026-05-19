import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { meetingSessions, rooms, users } from "@ossmeet/db/schema";
import { createTestDb, type TestDb } from "@/test/db.ts";
import { finalizeMeetingEnd } from "../finalize";

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

async function insertMeeting(meetingId: string, hostId: string, activeStreamEgressId: string | null) {
  const now = new Date("2026-01-01T00:00:00.000Z");
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
    activeStreamEgressId,
    updatedAt: now,
  });
}

describe("finalizeMeetingEnd", () => {
  it("clears active stream egress state when ending a meeting", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host", "stream_egress_1");

    await expect(
      finalizeMeetingEnd(db, {
        meetingId: "meeting_1",
        hostPlan: "free",
        now: new Date("2026-01-01T01:00:00.000Z"),
      }),
    ).resolves.toBe(true);

    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, "meeting_1"),
      columns: { status: true, activeStreamEgressId: true },
    });

    expect(meeting).toEqual({
      status: "ended",
      activeStreamEgressId: null,
    });
  });
});
