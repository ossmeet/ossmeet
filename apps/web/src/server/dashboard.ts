import { createServerFn } from "@tanstack/react-start";
import {
  meetingArtifacts,
  meetingLivekitPresences,
  meetingSessions,
  meetingSummaries,
  rooms,
  spaceMembers,
  spaces,
  users,
} from "@ossmeet/db/schema";
import { and, count, desc, eq, exists, gte, inArray, isNull, or } from "drizzle-orm";
import { authMiddleware } from "./middleware";

export const getDashboardData = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { user, db } }) => {
    const [spacesResult, activeResult, linksResult, recentResult] = await Promise.all([
      getDashboardSpaces(db, user.id),
      getDashboardActiveMeetings(db, user.id),
      getDashboardMeetingLinks(db, user.id),
      getDashboardRecentMeetings(db, user.id),
    ]);

    return {
      spaces: spacesResult,
      activeMeetings: activeResult,
      meetingLinks: linksResult,
      recentMeetings: recentResult,
    };
  });

type DashboardDb = Parameters<typeof getDashboardSpaces>[0];

async function getDashboardSpaces(db: import("@ossmeet/db").Database, userId: string) {
  const results = await db
    .select({
      space: spaces,
      role: spaceMembers.role,
    })
    .from(spaceMembers)
    .innerJoin(spaces, and(eq(spaceMembers.spaceId, spaces.id), isNull(spaces.archivedAt)))
    .where(eq(spaceMembers.userId, userId));

  return {
    spaces: results.map((r) => ({ ...r.space, role: r.role })),
  };
}

async function getDashboardMeetingLinks(db: DashboardDb, userId: string) {
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
        eq(rooms.hostId, userId),
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
}

async function getDashboardActiveMeetings(db: DashboardDb, userId: string) {
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
                eq(meetingLivekitPresences.userId, userId),
                eq(meetingLivekitPresences.presenceStatus, "connected"),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(meetingSessions.startedAt));

  const meetingIds = activeMeetings.map((m) => m.id);
  const participantCounts = meetingIds.length
    ? await db
        .select({
          meetingId: meetingLivekitPresences.sessionId,
          count: count(),
        })
        .from(meetingLivekitPresences)
        .where(
          and(
            inArray(meetingLivekitPresences.sessionId, meetingIds),
            eq(meetingLivekitPresences.presenceStatus, "connected"),
          ),
        )
        .groupBy(meetingLivekitPresences.sessionId)
    : [];

  const countMap = new Map(participantCounts.map((c) => [c.meetingId, c.count]));

  return {
    meetings: activeMeetings.map((m) => ({
      ...m,
      participantCount: countMap.get(m.id) ?? 0,
      startedAt: m.startedAt?.toISOString() ?? null,
    })),
  };
}

async function getDashboardRecentMeetings(db: DashboardDb, userId: string) {
  const rows = await db
    .select({
      id: meetingSessions.id,
      sessionId: meetingSessions.id,
      roomId: rooms.id,
      code: rooms.code,
      sessionSlug: meetingSessions.publicSlug,
      title: meetingSessions.title,
      status: meetingSessions.status,
      startedAt: meetingSessions.startedAt,
      endedAt: meetingSessions.endedAt,
      spaceId: meetingSessions.spaceId,
      spaceName: spaces.name,
      hostName: users.name,
      hasSummary: meetingSummaries.id,
      isHost: meetingSessions.hostId,
    })
    .from(meetingSessions)
    .innerJoin(
      meetingLivekitPresences,
      and(
        eq(meetingLivekitPresences.sessionId, meetingSessions.id),
        eq(meetingLivekitPresences.userId, userId),
      ),
    )
    .innerJoin(rooms, eq(meetingSessions.roomId, rooms.id))
    .leftJoin(spaces, eq(meetingSessions.spaceId, spaces.id))
    .innerJoin(users, eq(meetingSessions.hostId, users.id))
    .leftJoin(meetingSummaries, eq(meetingSummaries.sessionId, meetingSessions.id))
    .where(eq(meetingSessions.status, "ended"))
    .groupBy(
      meetingSessions.id,
      rooms.id,
      rooms.code,
      meetingSessions.publicSlug,
      meetingSessions.title,
      meetingSessions.status,
      meetingSessions.startedAt,
      meetingSessions.endedAt,
      meetingSessions.spaceId,
      spaces.name,
      meetingSessions.hostId,
      users.name,
      meetingSummaries.id,
    )
    .orderBy(desc(meetingSessions.startedAt))
    .limit(20);

  const sessionIds = rows.map((r) => r.id);
  const [participantCounts, whiteboardArtifacts] = sessionIds.length
    ? await Promise.all([
        db
          .select({ sessionId: meetingLivekitPresences.sessionId, count: count() })
          .from(meetingLivekitPresences)
          .where(inArray(meetingLivekitPresences.sessionId, sessionIds))
          .groupBy(meetingLivekitPresences.sessionId),
        db
          .select({ sessionId: meetingArtifacts.sessionId, type: meetingArtifacts.type })
          .from(meetingArtifacts)
          .where(
            and(
              inArray(meetingArtifacts.sessionId, sessionIds),
              inArray(meetingArtifacts.type, ["whiteboard_state", "whiteboard_pdf"]),
            ),
          ),
      ])
    : [[], []] as const;

  const countMap = new Map(participantCounts.map((c) => [c.sessionId, c.count]));
  const whiteboardStateSessionIds = new Set(
    whiteboardArtifacts.filter((artifact) => artifact.type === "whiteboard_state").map((artifact) => artifact.sessionId),
  );
  const whiteboardPdfSessionIds = new Set(
    whiteboardArtifacts.filter((artifact) => artifact.type === "whiteboard_pdf").map((artifact) => artifact.sessionId),
  );

  return {
    meetings: rows.map((r) => ({
      ...r,
      hasSummary: Boolean(r.hasSummary),
      isHost: r.isHost === userId,
      participantCount: countMap.get(r.id) ?? 0,
      hasWhiteboard: whiteboardStateSessionIds.has(r.id),
      hasWhiteboardPdf: whiteboardPdfSessionIds.has(r.id),
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
    })),
  };
}
