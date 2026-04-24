import { createServerFn } from "@tanstack/react-start";
import { meetingSummaries } from "@ossmeet/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authMiddleware } from "../middleware";
import { Errors } from "@ossmeet/shared";
import { canAccessMeetingTranscriptData } from "./access";

const getSummarySchema = z.object({
  meetingId: z.string().min(1),
});

/**
 * Fetch the latest meeting summary. Requires auth.
 */
export const getMeetingSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(getSummarySchema)
  .handler(async ({ data, context: { user, db } }) => {
    const { meetingId } = data;

    const allowed = await canAccessMeetingTranscriptData(db, meetingId, user.id);
    if (!allowed) throw Errors.FORBIDDEN();

    const row = await db
      .select({
        id: meetingSummaries.id,
        summary: meetingSummaries.summary,
        topics: meetingSummaries.topics,
        actionItems: meetingSummaries.actionItems,
        decisions: meetingSummaries.decisions,
        durationSeconds: meetingSummaries.durationSeconds,
        participantCount: meetingSummaries.participantCount,
        createdAt: meetingSummaries.createdAt,
      })
      .from(meetingSummaries)
      .where(eq(meetingSummaries.sessionId, meetingId))
      .orderBy(desc(meetingSummaries.createdAt))
      .get();

    if (!row) return { summary: null };

    return {
      summary: {
        ...row,
        topics: row.topics ?? [],
        actionItems: row.actionItems ?? [],
        decisions: row.decisions ?? [],
      },
    };
  });
