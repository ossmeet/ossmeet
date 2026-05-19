import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./db.ts";
import {
  meetingAdmissions,
  meetingLivekitPresences,
  rooms,
  meetingSessions,
  passkeys,
  sessions,
  spaces,
  transcripts,
  users,
  verifications,
} from "@ossmeet/db/schema";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

async function insertUser(id = "usr_schema") {
  const now = new Date();
  await db.insert(users).values({
    id,
    name: "Schema User",
    email: `${id}@example.com`,
    normalizedEmail: `${id}@example.com`,
    image: null,
    plan: "free",
    role: "user",
    createdAt: now,
    updatedAt: now,
  });
}

describe("database schema integrity", () => {
  it("rejects present previous session token hashes that are not SHA-256 length", async () => {
    await insertUser();
    const now = new Date();

    await expect(
      db.insert(sessions).values({
        id: "ses_short_previous_hash",
        tokenHash: "a".repeat(64),
        previousTokenHash: "short",
        userId: "usr_schema",
        expiresAt: new Date(now.getTime() + 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 120_000),
        ipAddress: null,
        userAgent: null,
        createdAt: now,
      }),
    ).rejects.toBeDefined();
  });

  it("rejects required text values padded past their storage limit", async () => {
    const now = new Date();

    await expect(
      db.insert(users).values({
        id: "usr_padded_name",
        name: `A${" ".repeat(100)}`,
        email: "padded@example.com",
        normalizedEmail: "padded@example.com",
        image: null,
        plan: "free",
        role: "user",
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toBeDefined();
  });

  it("cascades deleted users out of admission rows instead of violating admission shape checks", async () => {
    await insertUser("usr_host");
    await insertUser("usr_member");
    const now = new Date();

    await db.insert(rooms).values({
      id: "room_user_delete",
      code: "def-ghij-klm",
      hostId: "usr_host",
      spaceId: null,
      title: "User Delete Meeting",
      allowGuests: true,
      recordingEnabled: false,
      requireApproval: false,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(meetingSessions).values({
      id: "mtg_user_delete",
      roomId: "room_user_delete",
      publicSlug: "user-delete",
      title: "User Delete Meeting",
      hostId: "usr_host",
      spaceId: null,
      status: "ended",
      allowGuests: true,
      recordingEnabled: false,
      requireApproval: false,
      locked: false,
      activeEgressId: null,
      startedAt: now,
      endedAt: now,
      retainUntil: new Date(now.getTime() + 60_000),
      updatedAt: now,
    });

    await db.insert(meetingAdmissions).values({
      id: "mad_deleted_user",
      sessionId: "mtg_user_delete",
      subjectType: "user",
      subjectUserId: "usr_member",
      displayName: "Member",
      guestSecretHash: null,
      requestedRole: "participant",
      grantedRole: "participant",
      admissionStatus: "approved",
      decidedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await expect(db.delete(users).where(eq(users.id, "usr_member"))).resolves.toBeDefined();

    const remaining = await db.query.meetingAdmissions.findFirst({
      where: eq(meetingAdmissions.id, "mad_deleted_user"),
    });
    expect(remaining).toBeUndefined();
  });

  it("rejects sessions whose sliding expiry exceeds the absolute expiry", async () => {
    await insertUser();
    const now = new Date();

    await expect(
      db.insert(sessions).values({
        id: "ses_invalid",
        tokenHash: "token-hash",
        previousTokenHash: null,
        userId: "usr_schema",
        expiresAt: new Date(now.getTime() + 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 30_000),
        ipAddress: null,
        userAgent: null,
        createdAt: now,
      }),
    ).rejects.toBeDefined();
  });

  it("rejects ended meetingSessions whose endedAt is before startedAt", async () => {
    await insertUser();
    const now = new Date();
    await db.insert(rooms).values({
      id: "room_invalid_session",
      code: "abc-defg-hij",
      hostId: "usr_schema",
      spaceId: null,
      title: "Broken Meeting",
      allowGuests: true,
      recordingEnabled: false,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      db.insert(meetingSessions).values({
        id: "mtg_invalid",
        roomId: "room_invalid_session",
        publicSlug: "mtg_invalid",
        title: "Broken Meeting",
        hostId: "usr_schema",
        spaceId: null,
        status: "ended",
        allowGuests: true,
        recordingEnabled: false,
        requireApproval: false,
        locked: false,
        activeEgressId: null,
        startedAt: now,
        endedAt: new Date(now.getTime() - 1_000),
        retainUntil: new Date(now.getTime() + 60_000),
        updatedAt: now,
      }),
    ).rejects.toBeDefined();
  });

  it("rejects reusable room codes that do not match the canonical meeting code format", async () => {
    await insertUser();
    const now = new Date();

    await expect(
      db.insert(rooms).values({
        id: "lnk_invalid",
        code: "room-1",
        hostId: "usr_schema",
        spaceId: null,
        title: "Broken Link",
        allowGuests: true,
        recordingEnabled: false,
        requireApproval: false,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toBeDefined();
  });

  it("rejects LiveKit presence rows whose disconnectedAt precedes tokenIssuedAt", async () => {
    await insertUser();
    const now = new Date();
    await db.insert(rooms).values({
      id: "room_valid",
      code: "jkl-mnop-qrs",
      hostId: "usr_schema",
      spaceId: null,
      title: "Valid Meeting",
      allowGuests: true,
      recordingEnabled: false,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(meetingSessions).values({
      id: "mtg_valid",
      roomId: "room_valid",
      publicSlug: "mtg_valid",
      title: "Valid Meeting",
      hostId: "usr_schema",
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

    await db.insert(meetingAdmissions).values({
      id: "mad_valid",
      sessionId: "mtg_valid",
      subjectType: "user",
      subjectUserId: "usr_schema",
      displayName: "Schema User",
      requestedRole: "participant",
      grantedRole: "participant",
      admissionStatus: "approved",
      decidedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      db.insert(meetingLivekitPresences).values({
        id: "mlp_invalid",
        sessionId: "mtg_valid",
        admissionId: "mad_valid",
        livekitIdentity: "usr_schema_mlp_invalid",
        userId: "usr_schema",
        role: "participant",
        presenceStatus: "disconnected",
        tokenIssuedAt: now,
        disconnectedAt: new Date(now.getTime() - 1_000),
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toBeDefined();
  });

  it("rejects oversized transcript segments", async () => {
    await insertUser();
    const now = new Date();
    await db.insert(rooms).values({
      id: "room_transcript_limit",
      code: "lmn-opqr-stu",
      hostId: "usr_schema",
      spaceId: null,
      title: "Transcript Limit",
      allowGuests: true,
      recordingEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(meetingSessions).values({
      id: "mtg_transcript_limit",
      roomId: "room_transcript_limit",
      publicSlug: "transcript-limit",
      title: "Transcript Limit",
      hostId: "usr_schema",
      spaceId: null,
      status: "ended",
      allowGuests: true,
      recordingEnabled: false,
      requireApproval: false,
      locked: false,
      activeEgressId: null,
      startedAt: now,
      endedAt: now,
      retainUntil: new Date(now.getTime() + 60_000),
      updatedAt: now,
    });

    await expect(
      db.insert(transcripts).values({
        id: "trn_oversized_text",
        sessionId: "mtg_transcript_limit",
        admissionId: null,
        connectionId: null,
        participantIdentity: "usr_schema",
        participantName: "Schema User",
        text: "a".repeat(32_769),
        segmentId: "segment-1",
        language: "en",
        speakerId: null,
        startedAt: now,
        updatedAt: now,
      }),
    ).rejects.toBeDefined();
  });

  it("requires credentials for usable guest admissions but allows revoked legacy guests", async () => {
    await insertUser();
    const now = new Date();
    await db.insert(rooms).values({
      id: "room_guest_shape",
      code: "stu-vwxy-zab",
      hostId: "usr_schema",
      spaceId: null,
      title: "Guest Shape",
      allowGuests: true,
      recordingEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(meetingSessions).values({
      id: "mtg_guest_shape",
      roomId: "room_guest_shape",
      publicSlug: "guest-shape",
      title: "Guest Shape",
      hostId: "usr_schema",
      spaceId: null,
      status: "ended",
      allowGuests: true,
      recordingEnabled: false,
      requireApproval: false,
      locked: false,
      activeEgressId: null,
      startedAt: now,
      endedAt: now,
      retainUntil: new Date(now.getTime() + 60_000),
      updatedAt: now,
    });

    await expect(
      db.insert(meetingAdmissions).values({
        id: "mad_guest_missing_secret",
        sessionId: "mtg_guest_shape",
        subjectType: "guest",
        subjectUserId: null,
        guestSecretHash: null,
        displayName: "Guest",
        requestedRole: "guest",
        grantedRole: "guest",
        admissionStatus: "approved",
        decidedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toBeDefined();

    await expect(
      db.insert(meetingAdmissions).values({
        id: "mad_guest_revoked_no_secret",
        sessionId: "mtg_guest_shape",
        subjectType: "guest",
        subjectUserId: null,
        guestSecretHash: null,
        displayName: "Guest",
        requestedRole: "guest",
        grantedRole: null,
        admissionStatus: "revoked",
        decidedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects malformed verification JSON payloads", async () => {
    await expect(
      db.insert(verifications).values({
        id: crypto.randomUUID(),
        type: "otp_signup",
        identifier: "signup:schema@example.com",
        value: "hash",
        data: "not-json",
        expiresAt: new Date(Date.now() + 60_000),
        updatedAt: new Date(),
      }),
    ).rejects.toBeDefined();
  });

  it("rejects malformed passkey transports payloads", async () => {
    await insertUser();
    const now = new Date();

    await expect(
      db.insert(passkeys).values({
        id: "psk_invalid",
        userId: "usr_schema",
        credentialId: "credential-id",
        publicKey: "public-key",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        transports: "not-json" as unknown as string[],
        name: "Laptop",
        createdAt: now,
        lastUsedAt: now,
      }),
    ).rejects.toBeDefined();
  });

  it("enforces foreign keys in the local test database like D1", async () => {
    const now = new Date();

    await expect(
      db.insert(sessions).values({
        id: "ses_missing_user",
        tokenHash: "a".repeat(64),
        previousTokenHash: null,
        userId: "usr_missing",
        expiresAt: new Date(now.getTime() + 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 120_000),
        ipAddress: null,
        userAgent: null,
        createdAt: now,
      }),
    ).rejects.toBeDefined();
  });

  it("accepts canonical space slugs and rejects malformed slugs", async () => {
    await insertUser();
    const now = new Date();

    await expect(
      db.insert(spaces).values({
        id: "spc_valid_slug",
        name: "Valid Space",
        description: null,
        slug: "valid-space-123",
        ownerId: "usr_schema",
        createdAt: now,
        updatedAt: now,
      }),
    ).resolves.toBeDefined();

    for (const [id, slug] of [
      ["spc_bad_upper", "Invalid"],
      ["spc_bad_char", "invalid!"],
      ["spc_bad_leading", "-invalid"],
      ["spc_bad_trailing", "invalid-"],
    ] as const) {
      await expect(
        db.insert(spaces).values({
          id,
          name: "Invalid Space",
          description: null,
          slug,
          ownerId: "usr_schema",
          createdAt: now,
          updatedAt: now,
        }),
      ).rejects.toBeDefined();
    }
  });
});
