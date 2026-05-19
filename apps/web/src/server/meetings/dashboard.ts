import { createServerFn } from "@tanstack/react-start";
import { meetingLivekitPresences, meetingSessions, rooms, spaces, users } from "@ossmeet/db/schema";
import { eq, and, desc, count, inArray, exists, gte, isNull, or } from "drizzle-orm";
import {
  chunkArray,
  d1MaxItemsPerStatement,
} from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
const PARTICIPANT_COUNT_CHUNK_SIZE = d1MaxItemsPerStatement(1, 1);

/**
 * Get user's active meetingSessions (meetingSessions they host or participate in that are currently running)
 */
export const getMyActiveMeetings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { user, db } }) => {
    // Get meetingSessions where user has at least one LiveKit-connected presence projection.
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
              .select({ id: meetingLivekitPresences.id })
              .from(meetingLivekitPresences)
              .where(
                and(
                  eq(meetingLivekitPresences.sessionId, meetingSessions.id),
                  eq(meetingLivekitPresences.userId, user.id),
                  eq(meetingLivekitPresences.presenceStatus, "connected"),
                )
              )
          )
        )
      )
      .orderBy(desc(meetingSessions.startedAt));

    // Get participant counts for each meeting
    const meetingIds = activeMeetings.map((m) => m.id);
    let participantCounts: { meetingId: string; count: number }[] = [];

    if (meetingIds.length > 0) {
      for (const chunk of chunkArray(meetingIds, PARTICIPANT_COUNT_CHUNK_SIZE)) {
        const counts = await db
          .select({
            meetingId: meetingLivekitPresences.sessionId,
            count: count(),
          })
          .from(meetingLivekitPresences)
          .where(
            and(
              inArray(meetingLivekitPresences.sessionId, chunk),
              eq(meetingLivekitPresences.presenceStatus, "connected"),
            )
          )
          .groupBy(meetingLivekitPresences.sessionId);

        participantCounts.push(...counts);
      }
    }

    const countMap = new Map(participantCounts.map((c) => [c.meetingId, c.count]));

    return {
      meetings: activeMeetings.map((m) => ({
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
      .where(
        and(
          eq(rooms.hostId, user.id),
          eq(rooms.type, "permanent"),
          isNull(rooms.archivedAt),
          or(isNull(rooms.expiresAt), gte(rooms.expiresAt, new Date())),
        ),
      )
      .orderBy(desc(rooms.lastUsedAt));

    return {
      links: roomRows.map((l) => ({
        ...l,
        lastUsedAt: l.lastUsedAt?.toISOString() ?? null,
        expiresAt: l.expiresAt?.toISOString() ?? null,
      })),
    };
  });
