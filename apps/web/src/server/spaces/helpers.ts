import { spaceMembers, meetingSessions, meetingParticipants } from "@ossmeet/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  chunkArray,
  d1MaxItemsPerStatement,
  OCCUPYING_MEETING_PARTICIPANT_STATUSES,
} from "@ossmeet/shared";
import { logError } from "@/lib/logger";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { RoomServiceClient } from "livekit-server-sdk";
import type { Database } from "@ossmeet/db";

const PARTICIPANT_BY_MEETING_CHUNK_SIZE =
  d1MaxItemsPerStatement(1, OCCUPYING_MEETING_PARTICIPANT_STATUSES.length + 1);

/** Look up a user's membership in a space. Returns undefined if not a member. */
export function findSpaceMembership(db: Database, spaceId: string, userId: string) {
  return db.query.spaceMembers.findFirst({
    where: and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)),
  });
}

/**
 * Atomically removes a user's space membership and marks their active meeting
 * participant rows as left, then disconnects them from any LiveKit rooms.
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
    const activeParticipantRows: Array<{
      meetingId: string;
      livekitIdentity: string | null;
    }> = [];
    const chunks = chunkArray(meetingIds, PARTICIPANT_BY_MEETING_CHUNK_SIZE);
    for (const chunk of chunks) {
      activeParticipantRows.push(
        ...(await db
          .select({
            meetingId: meetingParticipants.sessionId,
            livekitIdentity: meetingParticipants.livekitIdentity,
          })
          .from(meetingParticipants)
          .where(
            and(
              inArray(meetingParticipants.sessionId, chunk),
              eq(meetingParticipants.userId, userId),
              inArray(meetingParticipants.status, OCCUPYING_MEETING_PARTICIPANT_STATUSES)
            )
          )),
      );
    }
    // First chunk: delete membership atomically with the first participant update.
    // Subsequent chunks (rare — requires 100+ simultaneous active space meetingSessions):
    // update participants independently.
    await db.batch([
      db.delete(spaceMembers).where(
        and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId))
      ),
      db.update(meetingParticipants)
        .set({ status: "left", leftAt: now })
        .where(and(
          inArray(meetingParticipants.sessionId, chunks[0]),
          eq(meetingParticipants.userId, userId),
          inArray(meetingParticipants.status, OCCUPYING_MEETING_PARTICIPANT_STATUSES)
        )),
    ]);
    for (let i = 1; i < chunks.length; i++) {
      await db.update(meetingParticipants)
        .set({ status: "left", leftAt: now })
        .where(and(
          inArray(meetingParticipants.sessionId, chunks[i]),
          eq(meetingParticipants.userId, userId),
          inArray(meetingParticipants.status, OCCUPYING_MEETING_PARTICIPANT_STATUSES)
        ));
    }

    const lkHttpUrl = livekitHttpUrl(env.LIVEKIT_URL);
    const roomSvc = new RoomServiceClient(lkHttpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    await Promise.allSettled(
      activeParticipantRows.map((participant) => {
        const identity = participant.livekitIdentity ?? userId;
        return roomSvc.removeParticipant(`meet-${participant.meetingId}`, identity).catch((err) => {
          logError(
            `[spaces] Failed to evict participant ${identity} from room meet-${participant.meetingId}:`,
            err
          );
        });
      })
    );
  } else {
    await db.delete(spaceMembers).where(
      and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId))
    );
  }
}
