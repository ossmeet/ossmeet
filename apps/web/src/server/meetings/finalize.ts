import type { Database } from "@ossmeet/db";
import { meetingSessions, meetingParticipants } from "@ossmeet/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  chunkArray,
  computeRetainUntil,
  d1MaxItemsPerStatement,
  OCCUPYING_MEETING_PARTICIPANT_STATUSES,
} from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { withD1Retry } from "@/lib/db-utils";

const FINALIZE_MEETING_ID_CHUNK_SIZE =
  d1MaxItemsPerStatement(1, OCCUPYING_MEETING_PARTICIPANT_STATUSES.length + 1);

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
): Promise<void> {
  const ids = normalizeMeetingIds(meetingIds);
  if (ids.length === 0) return;

  const retainUntil = computeRetainUntil(hostPlan, now);
  for (const batchIds of chunkArray(ids, FINALIZE_MEETING_ID_CHUNK_SIZE)) {
    const meetingFilter = onlyActive
      ? and(inArray(meetingSessions.id, batchIds), eq(meetingSessions.status, "active"))
      : inArray(meetingSessions.id, batchIds);

    await withD1Retry(() =>
      db.batch([
        db
          .update(meetingSessions)
          .set({
            status: "ended",
            endedAt: now,
            updatedAt: now,
            activeEgressId: null,
            retainUntil,
          })
          .where(meetingFilter),
        db
          .update(meetingParticipants)
          .set({ status: "left", leftAt: now })
          .where(
            and(
              inArray(meetingParticipants.sessionId, batchIds),
              inArray(meetingParticipants.status, OCCUPYING_MEETING_PARTICIPANT_STATUSES),
            ),
          ),
      ]),
    );
  }
}

export async function finalizeMeetingEnd(
  db: Database,
  { meetingId, hostPlan, now, onlyActive = true }: FinalizeMeetingEndInput,
): Promise<void> {
  await finalizeMeetingsEnd(db, {
    meetingIds: [meetingId],
    hostPlan,
    now,
    onlyActive,
  });
}

export async function finalizeMeetingsEndByHostPlan(
  db: Database,
  {
    meetingIds,
    hostPlanByMeetingId,
    now = new Date(),
    onlyActive = true,
  }: FinalizeMeetingsEndByHostPlanInput,
): Promise<void> {
  const ids = normalizeMeetingIds(meetingIds);
  if (ids.length === 0) return;

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

  for (const [plan, idsForPlan] of grouped.entries()) {
    await finalizeMeetingsEnd(db, {
      meetingIds: idsForPlan,
      hostPlan: plan,
      now,
      onlyActive,
    });
  }
}
