import type { Database } from "@ossmeet/db";
import { meetingSessions, meetingParticipants, users } from "@ossmeet/db/schema";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  chunkArray,
  CURRENT_MEETING_PARTICIPANT_STATUSES,
  d1MaxItemsPerStatement,
  type PlanType,
} from "@ossmeet/shared";
import { finalizeMeetingEnd, finalizeMeetingsEndByHostPlan } from "./finalize";
import { archiveMeetingTranscriptsToR2 } from "@/server/transcripts/archive";
import { logError } from "@/lib/logger";

const SESSION_LOOKUP_CHUNK_SIZE = d1MaxItemsPerStatement(1, 1);

export interface FinalizedSessionInfo {
  meetingId: string;
  activeEgressId: string | null;
}

interface FinalizeSessionByMeetingIdInput {
  meetingId: string;
  now?: Date;
  onlyActive?: boolean;
  env?: Pick<Env, "R2_BUCKET">;
}

interface FinalizeSessionsByMeetingIdsInput {
  meetingIds: string[];
  now?: Date;
  onlyActive?: boolean;
  env?: Pick<Env, "R2_BUCKET">;
}

function normalizeMeetingIds(meetingIds: string[]): string[] {
  return Array.from(new Set(meetingIds.filter(Boolean)));
}

export async function finalizeSessionByMeetingId(
  db: Database,
  { meetingId, now = new Date(), onlyActive = true, env }: FinalizeSessionByMeetingIdInput,
): Promise<FinalizedSessionInfo | null> {
  const meeting = await db.query.meetingSessions.findFirst({
    where: eq(meetingSessions.id, meetingId),
    columns: { id: true, hostId: true, status: true, activeEgressId: true },
  });
  if (!meeting) return null;
  if (onlyActive && meeting.status !== "active") return null;

  const host = await db.query.users.findFirst({
    where: eq(users.id, meeting.hostId),
    columns: { plan: true },
  });

  await finalizeMeetingEnd(db, {
    meetingId: meeting.id,
    hostPlan: (host?.plan as PlanType) ?? "free",
    now,
    onlyActive,
  });

  if (env) {
    archiveMeetingTranscriptsToR2(db, env, meeting.id).catch((err) => {
      logError(`[session-finalizer] Transcript archive failed for meeting ${meeting.id}:`, err);
    });
  }

  return {
    meetingId: meeting.id,
    activeEgressId: meeting.activeEgressId,
  };
}

export async function finalizeSessionsByMeetingIds(
  db: Database,
  { meetingIds, now = new Date(), onlyActive = true, env }: FinalizeSessionsByMeetingIdsInput,
): Promise<string[]> {
  const ids = normalizeMeetingIds(meetingIds);
  if (ids.length === 0) return [];

  const rows: Array<{ id: string; hostPlan: PlanType }> = [];
  const chunkSize = onlyActive ? SESSION_LOOKUP_CHUNK_SIZE : d1MaxItemsPerStatement();
  for (const chunk of chunkArray(ids, chunkSize)) {
    rows.push(
      ...(await db
        .select({
          id: meetingSessions.id,
          hostPlan: users.plan,
        })
        .from(meetingSessions)
        .innerJoin(users, eq(users.id, meetingSessions.hostId))
        .where(
          onlyActive
            ? and(inArray(meetingSessions.id, chunk), eq(meetingSessions.status, "active"))
            : inArray(meetingSessions.id, chunk),
        )),
    );
  }

  if (rows.length === 0) return [];

  const hostPlanByMeetingId = new Map<string, PlanType>();
  for (const row of rows) {
    hostPlanByMeetingId.set(row.id, (row.hostPlan as PlanType) ?? "free");
  }

  await finalizeMeetingsEndByHostPlan(db, {
    meetingIds: rows.map((row) => row.id),
    hostPlanByMeetingId,
    now,
    onlyActive,
  });

  const finalizedIds = rows.map((row) => row.id);
  if (env) {
    await Promise.allSettled(
      finalizedIds.map((meetingId) =>
        archiveMeetingTranscriptsToR2(db, env, meetingId).catch((err) => {
          logError(`[session-finalizer] Transcript archive failed for meeting ${meetingId}:`, err);
        }),
      ),
    );
  }

  return finalizedIds;
}

interface FinalizeSessionIfEmptyInput {
  meetingId: string;
  now?: Date;
  onlyActive?: boolean;
  env?: Pick<Env, "R2_BUCKET">;
}

export async function finalizeSessionIfEmpty(
  db: Database,
  { meetingId, now = new Date(), onlyActive = true, env }: FinalizeSessionIfEmptyInput,
): Promise<FinalizedSessionInfo | null> {
  const [activeCount] = await db
    .select({ count: count() })
    .from(meetingParticipants)
    .where(
      and(
        eq(meetingParticipants.sessionId, meetingId),
        inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
      )
    );

  if ((activeCount?.count ?? 0) > 0) return null;

  return finalizeSessionByMeetingId(db, { meetingId, now, onlyActive, env });
}
