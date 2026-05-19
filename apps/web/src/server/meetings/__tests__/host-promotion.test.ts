import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { meetingAdmissions, meetingLivekitPresences, meetingSessions, rooms, users } from "@ossmeet/db/schema";
import { createTestDb, type TestDb } from "@/test/db.ts";
import { maybePromoteSuccessorHost, type HostPromotionRealtimeServices } from "../leave-end.server";

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

async function insertConnection(input: {
  id: string;
  meetingId: string;
  userId: string | null;
  role: "host" | "participant" | "guest";
  status: "connected" | "disconnected";
  connectedAt: Date;
}) {
  const now = new Date();
  await db.insert(meetingAdmissions).values({
    id: `admission_${input.id}`,
    sessionId: input.meetingId,
    subjectType: input.userId ? "user" : "guest",
    subjectUserId: input.userId,
    guestSecretHash: input.userId ? null : "guest-secret-hash",
    displayName: input.userId ?? "Guest",
    requestedRole: input.role,
    grantedRole: input.role,
    admissionStatus: "approved",
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(meetingLivekitPresences).values({
    id: input.id,
    sessionId: input.meetingId,
    admissionId: `admission_${input.id}`,
    livekitIdentity: input.userId ? `${input.userId}_identity` : `guest_${input.id}`,
    livekitParticipantSid: `sid_${input.id}`,
    userId: input.userId,
    role: input.role,
    presenceStatus: input.status,
    disconnectReason: input.status === "disconnected" ? "participant_left" : null,
    tokenIssuedAt: input.connectedAt,
    connectedAt: input.connectedAt,
    disconnectedAt: input.status === "disconnected" ? now : null,
    lastWebhookAt: now,
    createdAt: input.connectedAt,
    updatedAt: now,
  });
}

async function getMeetingHostId(meetingId: string) {
  const row = await db.query.meetingSessions.findFirst({
    where: eq(meetingSessions.id, meetingId),
    columns: { hostId: true },
  });
  return row?.hostId;
}

async function getPresenceRole(connectionId: string) {
  const row = await db.query.meetingLivekitPresences.findFirst({
    where: eq(meetingLivekitPresences.id, connectionId),
    columns: { role: true },
  });
  return row?.role;
}

describe("maybePromoteSuccessorHost", () => {
  it("promotes the oldest connected participant after the host leaves without changing room ownership", async () => {
    await insertUser("host");
    await insertUser("member_1");
    await insertUser("member_2");
    await insertMeeting("meeting_1", "host");
    await insertConnection({
      id: "host_conn",
      meetingId: "meeting_1",
      userId: "host",
      role: "host",
      status: "disconnected",
      connectedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await insertConnection({
      id: "member_2_conn",
      meetingId: "meeting_1",
      userId: "member_2",
      role: "participant",
      status: "connected",
      connectedAt: new Date("2026-01-01T00:00:20.000Z"),
    });
    await insertConnection({
      id: "member_1_conn",
      meetingId: "meeting_1",
      userId: "member_1",
      role: "participant",
      status: "connected",
      connectedAt: new Date("2026-01-01T00:00:10.000Z"),
    });

    const promoteHost = vi.fn<HostPromotionRealtimeServices["promoteHost"]>().mockResolvedValue(undefined);
    const result = await maybePromoteSuccessorHost(db, "meeting_1", {} as Env, { promoteHost });

    expect(result).toEqual({ promoted: true, successorIdentity: "member_1_identity" });
    expect(promoteHost).toHaveBeenCalledWith(expect.anything(), "meeting_1", "member_1_identity");
    await expect(getMeetingHostId("meeting_1")).resolves.toBe("host");
    await expect(getPresenceRole("member_1_conn")).resolves.toBe("host");
    await expect(getPresenceRole("member_2_conn")).resolves.toBe("participant");
  });

  it("can promote a guest as acting host", async () => {
    await insertUser("host");
    await insertMeeting("meeting_1", "host");
    await insertConnection({
      id: "host_conn",
      meetingId: "meeting_1",
      userId: "host",
      role: "host",
      status: "disconnected",
      connectedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await insertConnection({
      id: "guest_conn",
      meetingId: "meeting_1",
      userId: null,
      role: "guest",
      status: "connected",
      connectedAt: new Date("2026-01-01T00:00:10.000Z"),
    });

    const promoteHost = vi.fn<HostPromotionRealtimeServices["promoteHost"]>().mockResolvedValue(undefined);
    const result = await maybePromoteSuccessorHost(db, "meeting_1", {} as Env, { promoteHost });

    expect(result).toEqual({ promoted: true, successorIdentity: "guest_guest_conn" });
    expect(promoteHost).toHaveBeenCalledWith(expect.anything(), "meeting_1", "guest_guest_conn");
    await expect(getMeetingHostId("meeting_1")).resolves.toBe("host");
    await expect(getPresenceRole("guest_conn")).resolves.toBe("host");
  });

  it("rolls back the host election if realtime promotion fails", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertConnection({
      id: "host_conn",
      meetingId: "meeting_1",
      userId: "host",
      role: "host",
      status: "disconnected",
      connectedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await insertConnection({
      id: "member_conn",
      meetingId: "meeting_1",
      userId: "member",
      role: "participant",
      status: "connected",
      connectedAt: new Date("2026-01-01T00:00:10.000Z"),
    });

    const promoteHost = vi.fn<HostPromotionRealtimeServices["promoteHost"]>().mockRejectedValue(new Error("livekit down"));

    await expect(
      maybePromoteSuccessorHost(db, "meeting_1", {} as Env, { promoteHost }),
    ).rejects.toThrow("livekit down");

    await expect(getMeetingHostId("meeting_1")).resolves.toBe("host");
    await expect(getPresenceRole("member_conn")).resolves.toBe("participant");
  });
});
