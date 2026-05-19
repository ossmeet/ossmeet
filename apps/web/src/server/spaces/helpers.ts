import { spaceMembers, meetingSessions, meetingLivekitPresences } from "@ossmeet/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  chunkArray,
  d1MaxItemsPerStatement,
} from "@ossmeet/shared";
import { logError } from "@/lib/logger";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import type { Database } from "@ossmeet/db";
import { withD1Retry } from "@/lib/db-utils";

const CONNECTION_BY_MEETING_CHUNK_SIZE =
  d1MaxItemsPerStatement(1, 4);

/** Look up a user's membership in a space. Returns undefined if not a member. */
export function findSpaceMembership(db: Database, spaceId: string, userId: string) {
  return db.query.spaceMembers.findFirst({
    where: and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)),
  });
}

/**
 * Atomically removes a user's space membership and marks their active meeting
 * connections as disconnected, then disconnects them from any LiveKit rooms.
 * Used by both removeMember and leaveSpace.
 */
export async function evictUserFromSpaceMeetings(
  db: Database,
  env: Env,
  spaceId: string,
  userId: string
): Promise<void> {
  const activeMeetings = await db
    .select({ id: meetingSessions.id })
    .from(meetingSessions)
    .where(and(eq(meetingSessions.spaceId, spaceId), eq(meetingSessions.status, "active")));

  const now = new Date();

  if (activeMeetings.length > 0) {
    const meetingIds = activeMeetings.map((m) => m.id);
    const activeConnectionRows: Array<{
      meetingId: string;
      livekitIdentity: string;
    }> = [];
    const chunks = chunkArray(meetingIds, CONNECTION_BY_MEETING_CHUNK_SIZE);
    for (const chunk of chunks) {
      activeConnectionRows.push(
        ...(await db
          .select({
            meetingId: meetingLivekitPresences.sessionId,
            livekitIdentity: meetingLivekitPresences.livekitIdentity,
          })
          .from(meetingLivekitPresences)
          .where(
            and(
              inArray(meetingLivekitPresences.sessionId, chunk),
              eq(meetingLivekitPresences.userId, userId),
              inArray(meetingLivekitPresences.presenceStatus, ["token_issued", "connected"])
            )
          )),
      );
    }
    // First chunk: delete membership atomically with the first connection update.
    // Subsequent chunks (rare — requires 100+ simultaneous active space meetingSessions):
    // update participants independently.
    const firstChunkUpdated = await withD1Retry(() =>
      db.batch([
        db.delete(spaceMembers).where(
          and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId))
        ),
        db.update(meetingLivekitPresences)
          .set({ presenceStatus: "disconnected", disconnectReason: "space_membership_removed", disconnectedAt: now, updatedAt: now })
          .where(and(
            inArray(meetingLivekitPresences.sessionId, chunks[0]),
            eq(meetingLivekitPresences.userId, userId),
            inArray(meetingLivekitPresences.presenceStatus, ["token_issued", "connected"])
          ))
          .returning({ meetingId: meetingLivekitPresences.sessionId }),
      ]),
    );
    void firstChunkUpdated;
    for (let i = 1; i < chunks.length; i++) {
      await withD1Retry(() =>
        db.update(meetingLivekitPresences)
          .set({ presenceStatus: "disconnected", disconnectReason: "space_membership_removed", disconnectedAt: now, updatedAt: now })
          .where(and(
            inArray(meetingLivekitPresences.sessionId, chunks[i]),
            eq(meetingLivekitPresences.userId, userId),
            inArray(meetingLivekitPresences.presenceStatus, ["token_issued", "connected"])
          ))
          .returning({ meetingId: meetingLivekitPresences.sessionId }),
      );
    }

    const lkHttpUrl = livekitHttpUrl(env.LIVEKIT_URL);
    const { RoomServiceClient } = await import(/* @vite-ignore */ "livekit-server-sdk");
    const roomSvc = new RoomServiceClient(lkHttpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    await Promise.allSettled(
      activeConnectionRows.map((connection) => {
        const identity = connection.livekitIdentity;
        return roomSvc.removeParticipant(`meet-${connection.meetingId}`, identity).catch((err) => {
          logError(
            `[spaces] Failed to evict participant ${identity} from room meet-${connection.meetingId}:`,
            err
          );
        });
      })
    );
  } else {
    await withD1Retry(() =>
      db.delete(spaceMembers).where(
        and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId))
      ),
    );
  }
}
