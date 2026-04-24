import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@ossmeet/db";
import { meetingParticipants, meetingSessions, rooms, users } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test/db";
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

async function insertActiveMeeting(meetingId: string, hostId: string) {
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
    activeEgressId: "egress_1",
    updatedAt: now,
  });
}

describe("finalizeMeetingEnd", () => {
  it("marks all non-terminal participant rows left, including approval-waiting rows", async () => {
    await insertUser("host");
    await insertActiveMeeting("meeting_1", "host");

    const now = new Date();
    await db.insert(meetingParticipants).values([
      {
        id: "participant_host",
        sessionId: "meeting_1",
        userId: "host",
        displayName: "host",
        role: "host",
        status: "active",
        livekitIdentity: "host_participant_host",
        guestSecret: null,
        joinedAt: now,
        leftAt: null,
      },
      {
        id: "participant_waiting",
        sessionId: "meeting_1",
        userId: null,
        displayName: "Guest",
        role: "guest",
        status: "awaiting_approval",
        livekitIdentity: "guest_participant_waiting",
        guestSecret: "x".repeat(64),
        joinedAt: now,
        leftAt: null,
      },
    ]);

    const endedAt = new Date(Math.ceil(Date.now() / 1000) * 1000 + 2000);
    await finalizeMeetingEnd(db as unknown as Database, {
      meetingId: "meeting_1",
      hostPlan: "free",
      now: endedAt,
      onlyActive: true,
    });

    const [meeting] = await db
      .select({
        status: meetingSessions.status,
        endedAt: meetingSessions.endedAt,
        activeEgressId: meetingSessions.activeEgressId,
      })
      .from(meetingSessions)
      .where(eq(meetingSessions.id, "meeting_1"));

    expect(meeting).toMatchObject({
      status: "ended",
      endedAt,
      activeEgressId: null,
    });

    const participants = await db
      .select({
        id: meetingParticipants.id,
        status: meetingParticipants.status,
        leftAt: meetingParticipants.leftAt,
      })
      .from(meetingParticipants)
      .where(eq(meetingParticipants.sessionId, "meeting_1"));

    expect(participants).toHaveLength(2);
    expect(participants.every((participant) => participant.status === "left")).toBe(true);
    expect(participants.every((participant) => participant.leftAt?.getTime() === endedAt.getTime())).toBe(true);
  });
});
