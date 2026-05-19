import type { Database } from "@ossmeet/db";
import { meetingLivekitPresences, meetingSessions } from "@ossmeet/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  chunkArray,
  computeRetainUntil,
  d1MaxItemsPerStatement,
} from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { getRunChanges, withD1Retry } from "@/lib/db-utils";

const FINALIZE_MEETING_ID_CHUNK_SIZE = d1MaxItemsPerStatement(1, 1);

interface FinalizeMeetingsEndInput {
  meetingIds: string[];
  hostPlan: PlanType;
  now?: Date;
  onlyActive?: boolean;
}

interface FinalizeMeetingEndInput {
  meetingId: string;
  hostPlan: PlanType;
  now?: Date;
  onlyActive?: boolean;
}

interface FinalizeMeetingsEndByHostPlanInput {
  meetingIds: string[];
  hostPlanByMeetingId: Map<string, PlanType>;
  now?: Date;
  onlyActive?: boolean;
}

function normalizeMeetingIds(meetingIds: string[]): string[] {
  return Array.from(new Set(meetingIds.filter(Boolean)));
}

export async function finalizeMeetingsEnd(
  db: Database,
  { meetingIds, hostPlan, now = new Date(), onlyActive = true }: FinalizeMeetingsEndInput,
): Promise<number> {
  const ids = normalizeMeetingIds(meetingIds);
  if (ids.length === 0) return 0;

  let finalizedCount = 0;
  const retainUntil = computeRetainUntil(hostPlan, now);
  for (const batchIds of chunkArray(ids, FINALIZE_MEETING_ID_CHUNK_SIZE)) {
    const meetingFilter = onlyActive
      ? and(inArray(meetingSessions.id, batchIds), eq(meetingSessions.status, "active"))
      : inArray(meetingSessions.id, batchIds);

    const [meetingUpdateResult] = await withD1Retry(() =>
      db.batch([
        db
          .update(meetingSessions)
          .set({
            status: "ended",
            endedAt: now,
            updatedAt: now,
            activeEgressId: null,
            activeStreamEgressId: null,
            retainUntil,
          })
          .where(meetingFilter),
        db
          .update(meetingLivekitPresences)
          .set({
            presenceStatus: "disconnected",
            disconnectReason: "session_finalized",
            disconnectedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              inArray(meetingLivekitPresences.sessionId, batchIds),
              inArray(meetingLivekitPresences.presenceStatus, ["token_issued", "connected"]),
            ),
          ),
      ]),
    );
    finalizedCount += getRunChanges(meetingUpdateResult);
  }

  return finalizedCount;
}

export async function finalizeMeetingEnd(
  db: Database,
  { meetingId, hostPlan, now, onlyActive = true }: FinalizeMeetingEndInput,
): Promise<boolean> {
  const finalizedCount = await finalizeMeetingsEnd(db, {
    meetingIds: [meetingId],
    hostPlan,
    now,
    onlyActive,
  });
  return finalizedCount > 0;
}

export async function finalizeMeetingsEndByHostPlan(
  db: Database,
  {
    meetingIds,
    hostPlanByMeetingId,
    now = new Date(),
    onlyActive = true,
  }: FinalizeMeetingsEndByHostPlanInput,
): Promise<number> {
  const ids = normalizeMeetingIds(meetingIds);
  if (ids.length === 0) return 0;

  const grouped = new Map<PlanType, string[]>();
  for (const meetingId of ids) {
    const plan = hostPlanByMeetingId.get(meetingId) ?? "free";
    const existing = grouped.get(plan);
    if (existing) {
      existing.push(meetingId);
    } else {
      grouped.set(plan, [meetingId]);
    }
  }

  let finalizedCount = 0;
  for (const [plan, idsForPlan] of grouped.entries()) {
    finalizedCount += await finalizeMeetingsEnd(db, {
      meetingIds: idsForPlan,
      hostPlan: plan,
      now,
      onlyActive,
    });
  }
  return finalizedCount;
}
