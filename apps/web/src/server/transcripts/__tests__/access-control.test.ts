import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/db.ts";
import type { Database } from "@ossmeet/db";
import { meetingAdmissions, meetingLivekitPresences, meetingSessions, rooms, spaceMembers, spaces, users } from "@ossmeet/db/schema";
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

async function insertAdmission(
  meetingId: string,
  userId: string,
  opts?: {
    role?: "host" | "participant" | "guest";
    admissionStatus?: "awaiting_approval" | "approved" | "denied" | "revoked";
    presenceStatus?: "token_issued" | "connected" | "disconnected" | "aborted";
  },
) {
  const now = new Date();
  const admissionStatus = opts?.admissionStatus ?? "approved";
  await db.insert(meetingAdmissions).values({
    id: `mad_${meetingId}_${userId}`,
    sessionId: meetingId,
    subjectType: "user",
    subjectUserId: userId,
    displayName: userId,
    requestedRole: opts?.role ?? "participant",
    grantedRole: admissionStatus === "approved" ? opts?.role ?? "participant" : null,
    admissionStatus,
    decidedAt: admissionStatus === "awaiting_approval" ? null : now,
    createdAt: now,
    updatedAt: now,
  });
  if (opts?.presenceStatus) {
    await db.insert(meetingLivekitPresences).values({
      id: `mlp_${meetingId}_${userId}`,
      sessionId: meetingId,
      admissionId: `mad_${meetingId}_${userId}`,
      livekitIdentity: userId,
      userId,
      role: opts.role ?? "participant",
      presenceStatus: opts.presenceStatus,
      tokenIssuedAt: now,
      connectedAt: opts.presenceStatus === "connected" ? now : null,
      disconnectedAt: opts.presenceStatus === "disconnected" || opts.presenceStatus === "aborted" ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

describe("meeting transcript/asset access", () => {
  it("allows transcript access to a space meeting participant with current membership", async () => {
    await insertUser("host");
    await insertUser("participant");
    await insertSpace("space_1", "host");
    await insertMembership("space_1", "host", "owner");
    await insertMembership("space_1", "participant", "member");
    await insertMeeting("meeting_1", "host", "space_1");
    await insertAdmission("meeting_1", "participant");

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
    await insertAdmission("meeting_1", "participant");

    await expect(
      canAccessMeetingTranscriptData(getAppDb(), "meeting_1", "participant"),
    ).resolves.toBe(false);
  });

  it("denies transcript access to users who were denied admission", async () => {
    await insertUser("host");
    await insertUser("participant");
    await insertMeeting("meeting_1", "host", null, "ended");
    await insertAdmission("meeting_1", "participant", { admissionStatus: "denied" });

    await expect(
      canAccessMeetingTranscriptData(getAppDb(), "meeting_1", "participant"),
    ).resolves.toBe(false);
  });

  it("denies transcript access to users still awaiting approval", async () => {
    await insertUser("host");
    await insertUser("participant");
    await insertMeeting("meeting_1", "host", null, "ended");
    await insertAdmission("meeting_1", "participant", { admissionStatus: "awaiting_approval" });

    await expect(
      canAccessMeetingTranscriptData(getAppDb(), "meeting_1", "participant"),
    ).resolves.toBe(false);
  });

  it("denies active asset access to participants who have already left", async () => {
    await insertUser("host");
    await insertUser("participant");
    await insertMeeting("meeting_1", "host", null, "active");
    await insertAdmission("meeting_1", "participant", { presenceStatus: "disconnected" });

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
