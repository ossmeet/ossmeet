import { createServerFn } from "@tanstack/react-start";
import { meetingSessions, rooms, meetingParticipants, spaces, users } from "@ossmeet/db/schema";
import { eq, and, desc, count, inArray, exists } from "drizzle-orm";
import {
  chunkArray,
  CURRENT_MEETING_PARTICIPANT_STATUSES,
  d1MaxItemsPerStatement,
} from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { withTimeout } from "@/lib/with-timeout";
import { finalizeSessionsByMeetingIds } from "./session-finalizer";
import { logError } from "@/lib/logger";

const MISSING_ROOM_GRACE_MS = 2 * 60 * 1000;
const PARTICIPANT_COUNT_CHUNK_SIZE =
  d1MaxItemsPerStatement(1, CURRENT_MEETING_PARTICIPANT_STATUSES.length);

/**
 * Get user's active meetingSessions (meetingSessions they host or participate in that are currently running)
 */
export const getMyActiveMeetings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { user, db, env } }) => {
    // Get meetingSessions where user has at least one active participant row.
    // Uses EXISTS subquery to avoid duplicates when a user has multiple devices joined.
    const activeMeetings = await db
      .select({
        id: meetingSessions.id,
        sessionId: meetingSessions.id,
        roomId: rooms.id,
        code: rooms.code,
        title: meetingSessions.title,
        startedAt: meetingSessions.startedAt,
        spaceId: meetingSessions.spaceId,
        spaceName: spaces.name,
        hostName: users.name,
      })
      .from(meetingSessions)
      .innerJoin(rooms, eq(meetingSessions.roomId, rooms.id))
      .leftJoin(spaces, eq(meetingSessions.spaceId, spaces.id))
      .innerJoin(users, eq(meetingSessions.hostId, users.id))
      .where(
        and(
          eq(meetingSessions.status, "active"),
          exists(
            db
              .select({ id: meetingParticipants.id })
              .from(meetingParticipants)
              .where(
                and(
                  eq(meetingParticipants.sessionId, meetingSessions.id),
                  eq(meetingParticipants.userId, user.id),
                  inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
                )
              )
          )
        )
      )
      .orderBy(desc(meetingSessions.startedAt));

    let resolvedMeetings = activeMeetings;

    try {
      const graceThreshold = new Date(Date.now() - MISSING_ROOM_GRACE_MS);
      const candidates = activeMeetings.filter(
        (meeting) => meeting.startedAt && meeting.startedAt < graceThreshold,
      );

      if (candidates.length > 0) {
        const { RoomServiceClient } = await import(/* @vite-ignore */ "livekit-server-sdk");
        const roomService = new RoomServiceClient(
          livekitHttpUrl(env.LIVEKIT_URL),
          env.LIVEKIT_API_KEY,
          env.LIVEKIT_API_SECRET,
        );
        const expectedRoomNames = candidates.map((meeting) => `meet-${meeting.id}`);
        const existingRooms = await withTimeout(roomService.listRooms(expectedRoomNames), 10_000);
        const existingRoomNames = new Set(existingRooms.map((room) => room.name));

        const stale = candidates.filter((meeting) => !existingRoomNames.has(`meet-${meeting.id}`));
        if (stale.length > 0) {
          await finalizeSessionsByMeetingIds(db, {
            meetingIds: stale.map((meeting) => meeting.id),
            now: new Date(),
            onlyActive: true,
            env,
          });

          const staleIds = new Set(stale.map((meeting) => meeting.id));
          resolvedMeetings = activeMeetings.filter((meeting) => !staleIds.has(meeting.id));
        }
      }
    } catch (err) {
      logError("[dashboard] Failed to reconcile active meetingSessions with LiveKit:", err);
    }

    // Get participant counts for each meeting
    const meetingIds = resolvedMeetings.map((m) => m.id);
    let participantCounts: { meetingId: string; count: number }[] = [];

    if (meetingIds.length > 0) {
      for (const chunk of chunkArray(meetingIds, PARTICIPANT_COUNT_CHUNK_SIZE)) {
        const counts = await db
          .select({
            meetingId: meetingParticipants.sessionId,
            count: count(),
          })
          .from(meetingParticipants)
          .where(
            and(
              inArray(meetingParticipants.sessionId, chunk),
              inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES)
            )
          )
          .groupBy(meetingParticipants.sessionId);

        participantCounts.push(...counts);
      }
    }

    const countMap = new Map(participantCounts.map((c) => [c.meetingId, c.count]));

    return {
      meetings: resolvedMeetings.map((m) => ({
        ...m,
        participantCount: countMap.get(m.id) ?? 0,
        startedAt: m.startedAt?.toISOString() ?? null,
      })),
    };
  });

/**
 * Get user's permanent rooms.
 */
export const getMyMeetingLinks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { user, db } }) => {
    const roomRows = await db
      .select({
        id: rooms.id,
        code: rooms.code,
        title: rooms.title,
        spaceId: rooms.spaceId,
        spaceName: spaces.name,
        lastUsedAt: rooms.lastUsedAt,
        expiresAt: rooms.expiresAt,
      })
      .from(rooms)
      .leftJoin(spaces, eq(rooms.spaceId, spaces.id))
      .where(and(eq(rooms.hostId, user.id), eq(rooms.type, "permanent")))
      .orderBy(desc(rooms.lastUsedAt));

    return {
      links: roomRows.map((l) => ({
        ...l,
        lastUsedAt: l.lastUsedAt?.toISOString() ?? null,
        expiresAt: l.expiresAt?.toISOString() ?? null,
      })),
    };
  });
