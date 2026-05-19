import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";
import { meetingAdmissions, meetingSessions, meetingSummaries } from "@ossmeet/db/schema";
import { AppError, Errors } from "@ossmeet/shared";
import { verifyGuestSecret } from "@/lib/auth/crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { canAccessMeetingTranscriptData } from "./access";
import { generateMeetingNotesForSession } from "./generate-notes";

const AUTH_HELPERS_MODULE = "../auth/helpers";

const getPostMeetingSummarySchema = z.object({
  meetingId: z.string().min(1),
  admissionId: z.string().min(1),
});

async function assertParticipantCanAccessPostMeetingSummary(
  db: import("@ossmeet/db").Database,
  meetingId: string,
  admissionId: string,
): Promise<void> {
  const { requireAuth, getGuestCookieSecret } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);

  try {
    const user = await requireAuth();
    const allowed = await canAccessMeetingTranscriptData(db, meetingId, user.id);
    if (allowed) return;
    throw Errors.FORBIDDEN();
  } catch (err) {
    if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;
  }

  const guestSecretHash = getGuestCookieSecret(admissionId);
  if (!guestSecretHash) throw Errors.UNAUTHORIZED();

  const admission = await db.query.meetingAdmissions.findFirst({
    where: and(
      eq(meetingAdmissions.id, admissionId),
      eq(meetingAdmissions.sessionId, meetingId),
      eq(meetingAdmissions.subjectType, "guest"),
      isNull(meetingAdmissions.subjectUserId),
    ),
    columns: { guestSecretHash: true },
  });

  if (!admission?.guestSecretHash) throw Errors.FORBIDDEN();
  if (!(await verifyGuestSecret(admission.guestSecretHash, guestSecretHash))) throw Errors.FORBIDDEN();
}

export const getPostMeetingSummaryForParticipant = createServerFn({ method: "POST" })
  .inputValidator(getPostMeetingSummarySchema)
  .handler(async ({ data }) => {
    const { getEnv } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    const env = await getEnv();
    const db = createDb(env.DB);

    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, data.meetingId),
      columns: { id: true, status: true },
    });
    if (!meeting) throw Errors.NOT_FOUND("Meeting");

    await assertParticipantCanAccessPostMeetingSummary(
      db,
      meeting.id,
      data.admissionId,
    );

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
      .where(eq(meetingSummaries.sessionId, meeting.id))
      .orderBy(desc(meetingSummaries.createdAt))
      .get();

    if (meeting.status !== "ended") {
      return { status: "active" as const, summary: null };
    }

    if (!row) {
      return { status: "pending" as const, summary: null };
    }

    return {
      status: "ready" as const,
      summary: {
        ...row,
        topics: row.topics ?? [],
        actionItems: row.actionItems ?? [],
        decisions: row.decisions ?? [],
      },
    };
  });

export const ensurePostMeetingSummaryForParticipant = createServerFn({ method: "POST" })
  .inputValidator(getPostMeetingSummarySchema)
  .handler(async ({ data }) => {
    const { getEnv } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    const env = await getEnv();
    const db = createDb(env.DB);

    const meeting = await db.query.meetingSessions.findFirst({
      where: eq(meetingSessions.id, data.meetingId),
      columns: { id: true, status: true },
    });
    if (!meeting) throw Errors.NOT_FOUND("Meeting");

    await assertParticipantCanAccessPostMeetingSummary(
      db,
      meeting.id,
      data.admissionId,
    );

    if (meeting.status !== "ended") {
      return { status: "active" as const, summary: null };
    }

    const result = await generateMeetingNotesForSession(db, env, meeting.id);
    if (result.summary) {
      return {
        status: "ready" as const,
        summary: result.summary,
      };
    }

    return {
      status: "pending" as const,
      summary: null,
      error: result.error ?? null,
    };
  });
