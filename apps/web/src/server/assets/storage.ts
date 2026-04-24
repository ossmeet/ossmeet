import type { Database } from "@ossmeet/db";
import { meetingArtifacts, spaceAssets } from "@ossmeet/db/schema";
import { eq, sql } from "drizzle-orm";

export async function getUserStoredBytes(db: Database, userId: string): Promise<number> {
  const [spaceUsage, meetingUsage] = await Promise.all([
    db
      .select({ total: sql<number>`COALESCE(SUM(${spaceAssets.size}), 0)` })
      .from(spaceAssets)
      .where(eq(spaceAssets.uploadedById, userId)),
    db
      .select({ total: sql<number>`COALESCE(SUM(${meetingArtifacts.size}), 0)` })
      .from(meetingArtifacts)
      .where(eq(meetingArtifacts.uploadedById, userId)),
  ]);

  return (spaceUsage[0]?.total ?? 0) + (meetingUsage[0]?.total ?? 0);
}
