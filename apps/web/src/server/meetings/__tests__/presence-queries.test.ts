import { beforeEach, describe, expect, it } from "vitest";
import { meetingAdmissions, meetingLivekitPresences, meetingSessions, rooms, users } from "@ossmeet/db/schema";
import { createTestDb, type TestDb } from "@/test/db.ts";
import {
  findConnectedPresenceByUserId,
  findWhiteboardEligiblePresenceByConnectionId,
  isMeetingAtSoftCapacity,
} from "../presence-queries";

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
    updatedAt: now,
  });
}

async function insertAdmission(id: string, meetingId: string, userId: string | null) {
  const now = new Date();
  await db.insert(meetingAdmissions).values({
    id,
    sessionId: meetingId,
    subjectType: userId ? "user" : "guest",
    subjectUserId: userId,
    guestSecretHash: userId ? null : "guest_secret_hash_hash",
    displayName: userId ?? "Guest",
    requestedRole: userId ? "participant" : "guest",
    grantedRole: userId ? "participant" : "guest",
    admissionStatus: "approved",
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertConnection(input: {
  id: string;
  meetingId: string;
  userId: string | null;
  status: "token_issued" | "connected" | "disconnected";
  tokenIssuedAt: Date;
  connectedAt?: Date | null;
  disconnectedAt?: Date | null;
}) {
  const admissionId = `mad_${input.id}`;
  await insertAdmission(admissionId, input.meetingId, input.userId);
  await db.insert(meetingLivekitPresences).values({
    id: input.id,
    sessionId: input.meetingId,
    admissionId,
    livekitIdentity: `${input.userId ?? "guest"}_${input.id}`,
    livekitParticipantSid: input.status === "token_issued" ? null : `PA_${input.id}`,
    userId: input.userId,
    role: input.userId ? "participant" : "guest",
    presenceStatus: input.status,
    disconnectReason: input.status === "disconnected" ? "network" : null,
    tokenIssuedAt: input.tokenIssuedAt,
    connectedAt: input.connectedAt ?? null,
    disconnectedAt: input.disconnectedAt ?? null,
    lastWebhookAt: input.status === "token_issued" ? null : (input.disconnectedAt ?? input.connectedAt ?? input.tokenIssuedAt),
    createdAt: input.tokenIssuedAt,
    updatedAt: input.disconnectedAt ?? input.connectedAt ?? input.tokenIssuedAt,
  });
}

describe("findConnectedPresenceByUserId", () => {
  it("returns an active connection even when a newer disconnected row exists", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_1", "host");
    await insertAdmission("mad_connected", "meeting_1", "member");
    await insertAdmission("mad_disconnected", "meeting_1", "member");

    const now = new Date();
    const stillConnectedTokenIssuedAt = new Date(now.getTime() - 40_000);
    const staleDisconnectedAt = new Date(now.getTime() - 5_000);

    await db.insert(meetingLivekitPresences).values([
      {
        id: "mlp_connected",
        sessionId: "meeting_1",
        admissionId: "mad_connected",
        livekitIdentity: "member_ptc_connected",
        livekitParticipantSid: "PA_connected",
        userId: "member",
        role: "participant",
        presenceStatus: "connected",
        disconnectReason: null,
        tokenIssuedAt: stillConnectedTokenIssuedAt,
        connectedAt: stillConnectedTokenIssuedAt,
        disconnectedAt: null,
        lastWebhookAt: stillConnectedTokenIssuedAt,
        createdAt: stillConnectedTokenIssuedAt,
        updatedAt: stillConnectedTokenIssuedAt,
      },
      {
        id: "mlp_disconnected_newer",
        sessionId: "meeting_1",
        admissionId: "mad_disconnected",
        livekitIdentity: "member_ptc_disconnected",
        livekitParticipantSid: "PA_disconnected",
        userId: "member",
        role: "participant",
        presenceStatus: "disconnected",
        disconnectReason: "left",
        tokenIssuedAt: new Date(now.getTime() - 9_000),
        connectedAt: new Date(now.getTime() - 9_000),
        disconnectedAt: staleDisconnectedAt,
        lastWebhookAt: staleDisconnectedAt,
        createdAt: new Date(now.getTime() - 10_000),
        updatedAt: staleDisconnectedAt,
      },
    ]);

    const presence = await findConnectedPresenceByUserId(db, "meeting_1", "member", now);
    expect(presence).toMatchObject({
      connectionId: "mlp_connected",
      livekitIdentity: "member_ptc_connected",
      userId: "member",
      role: "participant",
    });
  });

  it("keeps connected presence valid even when tokenIssuedAt is old", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_2", "host");
    await insertAdmission("mad_old_connected", "meeting_2", "member");

    const now = new Date();
    const connectedAt = new Date(now.getTime() - 20 * 60_000);

    await db.insert(meetingLivekitPresences).values({
      id: "mlp_old_connected",
      sessionId: "meeting_2",
      admissionId: "mad_old_connected",
      livekitIdentity: "member_ptc_old_connected",
      livekitParticipantSid: "PA_old_connected",
      userId: "member",
      role: "participant",
      presenceStatus: "connected",
      disconnectReason: null,
      tokenIssuedAt: connectedAt,
      connectedAt,
      disconnectedAt: null,
      lastWebhookAt: connectedAt,
      createdAt: connectedAt,
      updatedAt: connectedAt,
    });

    const presence = await findConnectedPresenceByUserId(db, "meeting_2", "member", now);
    expect(presence?.connectionId).toBe("mlp_old_connected");
  });

  it("drops token_issued rows from connected presence once the short join grace window passes", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_3", "host");

    const now = new Date();
    await insertConnection({
      id: "mlp_stale_token",
      meetingId: "meeting_3",
      userId: "member",
      status: "token_issued",
      tokenIssuedAt: new Date(now.getTime() - 61_000),
    });

    const presence = await findConnectedPresenceByUserId(db, "meeting_3", "member", now);
    expect(presence).toBeNull();
  });
});

describe("findWhiteboardEligiblePresenceByConnectionId", () => {
  it("allows a recently disconnected connection during the reconnect grace window", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_4", "host");
    await insertAdmission("mad_recent_disconnect", "meeting_4", "member");

    const now = new Date();
    const connectedAt = new Date(now.getTime() - 30_000);
    const disconnectedAt = new Date(now.getTime() - 5_000);

    await db.insert(meetingLivekitPresences).values({
      id: "mlp_recent_disconnect",
      sessionId: "meeting_4",
      admissionId: "mad_recent_disconnect",
      livekitIdentity: "member_ptc_recent_disconnect",
      livekitParticipantSid: "PA_recent_disconnect",
      userId: "member",
      role: "participant",
      presenceStatus: "disconnected",
      disconnectReason: "network",
      tokenIssuedAt: connectedAt,
      connectedAt,
      disconnectedAt,
      lastWebhookAt: disconnectedAt,
      createdAt: connectedAt,
      updatedAt: disconnectedAt,
    });

    const presence = await findWhiteboardEligiblePresenceByConnectionId(
      db,
      "meeting_4",
      "mlp_recent_disconnect",
      now,
    );

    expect(presence?.connectionId).toBe("mlp_recent_disconnect");
  });

  it("allows token_issued rows for whiteboard longer than capacity grace", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_5", "host");

    const now = new Date();
    await insertConnection({
      id: "mlp_whiteboard_token",
      meetingId: "meeting_5",
      userId: "member",
      status: "token_issued",
      tokenIssuedAt: new Date(now.getTime() - 90_000),
    });

    const presence = await findWhiteboardEligiblePresenceByConnectionId(
      db,
      "meeting_5",
      "mlp_whiteboard_token",
      now,
    );

    expect(presence?.connectionId).toBe("mlp_whiteboard_token");
  });

  it("drops stale token_issued rows after the whiteboard grace window", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_6", "host");

    const now = new Date();
    await insertConnection({
      id: "mlp_expired_whiteboard_token",
      meetingId: "meeting_6",
      userId: "member",
      status: "token_issued",
      tokenIssuedAt: new Date(now.getTime() - 121_000),
    });

    const presence = await findWhiteboardEligiblePresenceByConnectionId(
      db,
      "meeting_6",
      "mlp_expired_whiteboard_token",
      now,
    );

    expect(presence).toBeNull();
  });
});

describe("isMeetingAtSoftCapacity", () => {
  it("does not count token_issued rows after the short capacity grace window", async () => {
    await insertUser("host");
    await insertUser("member");
    await insertMeeting("meeting_7", "host");

    const now = new Date();
    await insertConnection({
      id: "mlp_stale_capacity_token",
      meetingId: "meeting_7",
      userId: "member",
      status: "token_issued",
      tokenIssuedAt: new Date(now.getTime() - 61_000),
    });

    await insertConnection({
      id: "mlp_connected_capacity",
      meetingId: "meeting_7",
      userId: "host",
      status: "connected",
      tokenIssuedAt: new Date(now.getTime() - 10 * 60_000),
      connectedAt: new Date(now.getTime() - 10 * 60_000),
    });

    await expect(isMeetingAtSoftCapacity(db, "meeting_7", 2)).resolves.toBe(false);
    await expect(isMeetingAtSoftCapacity(db, "meeting_7", 1)).resolves.toBe(true);
  });
});
