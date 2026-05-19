import type { Database } from "@ossmeet/db";
import { meetingAdmissions } from "@ossmeet/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { getRunChanges, withD1Retry } from "@/lib/db-utils";

export const AWAITING_APPROVAL_TTL_MS = 5 * 60 * 1000;

export async function expireStaleAwaitingParticipants(
  db: Database,
  meetingId: string,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - AWAITING_APPROVAL_TTL_MS);

  const admissionResult = await withD1Retry(() =>
    db
      .update(meetingAdmissions)
      .set({
        admissionStatus: "denied",
        decidedAt: now,
        decisionReason: "expired",
        updatedAt: now,
      })
      .where(
        and(
          eq(meetingAdmissions.sessionId, meetingId),
          eq(meetingAdmissions.admissionStatus, "awaiting_approval"),
          lt(meetingAdmissions.createdAt, cutoff),
        ),
      )
      .run(),
  );

  return getRunChanges(admissionResult);
}
