import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./db.ts";
import {
  meetingParticipants,
  rooms,
  meetingSessions,
  passkeys,
  sessions,
  spaces,
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

  it("cascades deleted users out of participant rows instead of violating participant shape checks", async () => {
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

    await db.insert(meetingParticipants).values({
      id: "ptc_deleted_user",
      sessionId: "mtg_user_delete",
      userId: "usr_member",
      displayName: "Member",
      role: "participant",
      status: "left",
      livekitIdentity: "usr_member_ptc_deleted_user",
      guestSecret: null,
      joinedAt: now,
      leftAt: now,
    });

    await expect(db.delete(users).where(eq(users.id, "usr_member"))).resolves.toBeDefined();

    const remaining = await db.query.meetingParticipants.findFirst({
      where: eq(meetingParticipants.id, "ptc_deleted_user"),
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

  it("rejects participant rows whose leftAt precedes joinedAt", async () => {
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

    await expect(
      db.insert(meetingParticipants).values({
        id: "ptc_invalid",
        sessionId: "mtg_valid",
        userId: "usr_schema",
        displayName: "Schema User",
        role: "participant",
        status: "left",
        livekitIdentity: "usr_schema_ptc_invalid",
        guestSecret: null,
        joinedAt: now,
        leftAt: new Date(now.getTime() - 1_000),
      }),
    ).rejects.toBeDefined();
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
