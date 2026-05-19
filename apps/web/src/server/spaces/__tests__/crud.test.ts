import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@ossmeet/db";
import { spaces, spaceMembers, users } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test/db.ts";
import { insertSpaceWithOwnerMembership } from "../crud";

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

describe("insertSpaceWithOwnerMembership", () => {
  it("creates the space and owner membership when under the plan limit", async () => {
    await insertUser("owner");
    const now = new Date();

    await expect(
      insertSpaceWithOwnerMembership(getAppDb(), {
        spaceId: "SPACE_1",
        memberId: "MEMBER_1",
        ownerId: "owner",
        name: "Space One",
        description: null,
        slug: "space-one",
        now,
        maxSpaces: 1,
      }),
    ).resolves.toBe(true);

    await expect(db.query.spaces.findFirst({ where: eq(spaces.id, "SPACE_1") })).resolves.toMatchObject({
      id: "SPACE_1",
      ownerId: "owner",
    });
    await expect(
      db.query.spaceMembers.findFirst({ where: eq(spaceMembers.id, "MEMBER_1") }),
    ).resolves.toMatchObject({
      id: "MEMBER_1",
      spaceId: "SPACE_1",
      userId: "owner",
      role: "owner",
    });
  });

  it("refuses creation without leaving partial rows behind when the limit is reached", async () => {
    await insertUser("owner");
    const now = new Date();

    await db.insert(spaces).values({
      id: "SPACE_EXISTING",
      name: "Existing",
      description: null,
      slug: "existing-space",
      ownerId: "owner",
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(spaceMembers).values({
      id: "MEMBER_EXISTING",
      spaceId: "SPACE_EXISTING",
      userId: "owner",
      role: "owner",
      joinedAt: now,
    });

    await expect(
      insertSpaceWithOwnerMembership(getAppDb(), {
        spaceId: "SPACE_BLOCKED",
        memberId: "MEMBER_BLOCKED",
        ownerId: "owner",
        name: "Blocked",
        description: null,
        slug: "blocked-space",
        now,
        maxSpaces: 1,
      }),
    ).resolves.toBe(false);

    await expect(db.query.spaces.findFirst({ where: eq(spaces.id, "SPACE_BLOCKED") })).resolves.toBeUndefined();
    await expect(
      db.query.spaceMembers.findFirst({ where: eq(spaceMembers.id, "MEMBER_BLOCKED") }),
    ).resolves.toBeUndefined();
  });
});
