import { beforeEach, describe, expect, it } from "vitest";
import { users, rooms, meetingSessions } from "@ossmeet/db/schema";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test/db.ts";

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

async function insertLink(linkId: string, hostId: string) {
  const now = new Date();
  await db.insert(rooms).values({
    id: linkId,
    code: "abc-defg-hij",
    hostId,
    spaceId: null,
    title: "Room",
    allowGuests: true,
    recordingEnabled: false,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
}

function buildMeetingRow(opts: {
  id: string;
  hostId: string;
  roomId: string;
  status: "active" | "ended";
}) {
  const now = new Date();
  return {
    id: opts.id,
    roomId: opts.roomId,
    publicSlug: opts.id,
    hostId: opts.hostId,
    spaceId: null,
    title: "Session",
    status: opts.status,
    allowGuests: true,
    recordingEnabled: false,
    startedAt: now,
    endedAt: opts.status === "ended" ? now : null,
    activeEgressId: null,
    updatedAt: now,
  } as const;
}

describe("meeting link active-session invariant", () => {
  it("enforces at most one active meeting per reusable link", async () => {
    await insertUser("host");
    await insertLink("link_1", "host");

    await db.insert(meetingSessions).values(
      buildMeetingRow({
        id: "meeting_1",
        hostId: "host",
        roomId: "link_1",
        status: "active",
      }),
    );

    await expect(
      db.insert(meetingSessions).values(
        buildMeetingRow({
          id: "meeting_2",
          hostId: "host",
          roomId: "link_1",
          status: "active",
        }),
      ),
    ).rejects.toBeDefined();

    const activeRows = await db
      .select({ id: meetingSessions.id })
      .from(meetingSessions)
      .where(and(eq(meetingSessions.roomId, "link_1"), eq(meetingSessions.status, "active")));
    expect(activeRows).toHaveLength(1);
  });

  it("allows historical ended sessions for the same link", async () => {
    await insertUser("host");
    await insertLink("link_1", "host");

    await db.insert(meetingSessions).values(
      buildMeetingRow({
        id: "meeting_1",
        hostId: "host",
        roomId: "link_1",
        status: "active",
      }),
    );

    await expect(
      db.insert(meetingSessions).values(
        buildMeetingRow({
          id: "meeting_2",
          hostId: "host",
          roomId: "link_1",
          status: "ended",
        }),
      ),
    ).resolves.toBeDefined();
  });
});
