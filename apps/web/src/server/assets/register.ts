import type { Database } from "@ossmeet/db";
import { meetingArtifacts, spaceAssets } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "@ossmeet/shared";
import { withD1Retry } from "@/lib/db-utils";

type SpaceAssetType = (typeof spaceAssets.$inferInsert)["type"];
type MeetingArtifactType = (typeof meetingArtifacts.$inferInsert)["type"];

interface RegisterSpaceAssetInput {
  spaceId: string | null;
  type: SpaceAssetType;
  r2Key: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedById: string | null;
  createdAt?: Date;
}

interface RegisterMeetingArtifactInput {
  sessionId?: string;
  meetingId?: string;
  spaceId: string | null;
  type: MeetingArtifactType;
  r2Key: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedById: string | null;
  createdAt?: Date;
}

export async function registerSpaceAssetMetadata(
  db: Database,
  input: RegisterSpaceAssetInput,
): Promise<void> {
  const createdAt = input.createdAt ?? new Date();

  const inserted = await withD1Retry(() =>
    db
      .insert(spaceAssets)
      .values({
        id: generateId("ASSET"),
        spaceId: input.spaceId,
        type: input.type,
        r2Key: input.r2Key,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        uploadedById: input.uploadedById,
        createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: spaceAssets.id }),
  );

  if (inserted.length === 0) {
    // Conflict case: row already exists, verify it
    const existing = await db.query.spaceAssets.findFirst({
      where: eq(spaceAssets.r2Key, input.r2Key),
      columns: { id: true },
    });
    if (!existing) {
      throw new Error(`Failed to register asset metadata for key: ${input.r2Key}`);
    }
  }
}

export async function registerMeetingArtifactMetadata(
  db: Database,
  input: RegisterMeetingArtifactInput,
): Promise<void> {
  const createdAt = input.createdAt ?? new Date();
  const sessionId = input.sessionId ?? input.meetingId;
  if (!sessionId) {
    throw new Error("sessionId is required to register meeting artifact metadata");
  }

  const inserted = await withD1Retry(() =>
    db
      .insert(meetingArtifacts)
      .values({
        id: generateId("MEETING_ARTIFACT"),
        sessionId,
        spaceId: input.spaceId,
        type: input.type,
        r2Key: input.r2Key,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        uploadedById: input.uploadedById,
        createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: meetingArtifacts.id }),
  );

  if (inserted.length === 0) {
    // Conflict case: row already exists, verify it
    const existing = await db.query.meetingArtifacts.findFirst({
      where: eq(meetingArtifacts.r2Key, input.r2Key),
      columns: { id: true },
    });
    if (!existing) {
      throw new Error(`Failed to register meeting artifact metadata for key: ${input.r2Key}`);
    }
  }
}
