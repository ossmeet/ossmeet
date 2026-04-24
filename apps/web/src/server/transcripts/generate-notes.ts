import { createServerFn } from "@tanstack/react-start";
import {
  transcripts,
  meetingSummaries,
  meetingSessions,
} from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  Errors,
  MEETING_NOTES_DETAIL_MAX_ITEMS,
  MEETING_NOTES_DETAIL_MAX_LENGTH,
  MEETING_NOTES_SUMMARY_MAX_LENGTH,
  MEETING_NOTES_TOPIC_MAX_ITEMS,
  MEETING_NOTES_TOPIC_MAX_LENGTH,
  generateId,
} from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { logError } from "@/lib/logger";
import { withD1Retry } from "@/lib/db-utils";
import { canAccessMeetingTranscriptData } from "./access";
import type { ArchivedTranscriptRow } from "./archive";

const ARCHIVE_MODULE = "./archive";
type ResolvedTranscriptRow = {
  participantName: string;
  text: string;
  startedAt: Date;
};

// Schema for the structured output we want from the LLM
const notesSchema = z.object({
  summary: z
    .string()
    .max(MEETING_NOTES_SUMMARY_MAX_LENGTH)
    .describe("2–3 sentence overview of what was discussed"),
  topics: z
    .array(z.string().max(MEETING_NOTES_TOPIC_MAX_LENGTH))
    .max(MEETING_NOTES_TOPIC_MAX_ITEMS)
    .describe("Key topics as short noun phrases"),
  actionItems: z
    .array(z.string().max(MEETING_NOTES_DETAIL_MAX_LENGTH))
    .max(MEETING_NOTES_DETAIL_MAX_ITEMS)
    .describe("Concrete next steps. Format as 'Person: task' when owner is clear"),
  decisions: z
    .array(z.string().max(MEETING_NOTES_DETAIL_MAX_LENGTH))
    .max(MEETING_NOTES_DETAIL_MAX_ITEMS)
    .describe("Explicit decisions made during the meeting"),
});

// Segments from the same speaker within this gap are merged into one turn.
const SAME_SPEAKER_MERGE_GAP_MS = 45_000;

function buildTranscriptText(
  rows: Array<{ participantName: string; text: string; startedAt: Date }>,
  meetingStartedAt: Date | null,
): string {
  const origin = meetingStartedAt ?? rows[0].startedAt;
  const lines: string[] = [];
  let i = 0;
  while (i < rows.length) {
    const speaker = rows[i].participantName;
    const turnStart = rows[i].startedAt;
    const segments: string[] = [];
    let prevMs = turnStart.getTime();
    while (i < rows.length) {
      const cur = rows[i];
      const gap = cur.startedAt.getTime() - prevMs;
      if (cur.participantName !== speaker || gap >= SAME_SPEAKER_MERGE_GAP_MS) break;
      const t = cur.text.trim();
      if (t) segments.push(t);
      prevMs = cur.startedAt.getTime();
      i++;
    }
    if (segments.length === 0) continue;
    const elapsedSec = Math.max(0, Math.floor((turnStart.getTime() - origin.getTime()) / 1000));
    const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
    const ss = String(elapsedSec % 60).padStart(2, "0");
    lines.push(`[${mm}:${ss} ${speaker}]: ${segments.join(" ")}`);
  }
  return lines.join("\n");
}

/**
 * Generate AI meeting notes from the accumulated transcript.
 *
 * Idempotent: returns the existing summary if one already exists.
 * Lazy: called on-demand (e.g. when the user opens the meeting recap page),
 * not automatically at meeting end — this avoids race conditions with the
 * final transcript flush.
 *
 * Uses Gemini Flash (AI_API_KEY / AI_MODEL env vars) via the Vercel AI SDK.
 * Handles multilingual / code-switched transcripts natively — no special
 * language config needed; Gemini understands mixed-language text in context.
 */
export const generateMeetingNotes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ meetingId: z.string().min(1) }))
  .handler(async ({ data, context: { user, db, env } }) => {
    const { archiveMeetingTranscriptsToR2, loadTranscriptArchiveFromR2 } = await import(
      /* @vite-ignore */ ARCHIVE_MODULE
    );
    const { meetingId } = data;

    const allowed = await canAccessMeetingTranscriptData(db, meetingId, user.id);
    if (!allowed) throw Errors.FORBIDDEN();

    // Return cached summary if already generated
    const existing = await db.query.meetingSummaries.findFirst({
      where: eq(meetingSummaries.sessionId, meetingId),
    });
    if (existing) {
      return {
        summary: {
          ...existing,
          topics: existing.topics ?? [],
          actionItems: existing.actionItems ?? [],
          decisions: existing.decisions ?? [],
        },
        generated: false,
      };
    }

    if (!env.AI_API_KEY || !env.AI_MODEL) {
      return { summary: null, generated: false, error: "ai_not_configured" };
    }
    const modelIds = [env.AI_MODEL, env.AI_MODEL_FALLBACK].filter(Boolean) as string[];

    // Read all transcript segments ordered chronologically
    const [d1Rows, meeting] = await Promise.all([
      db
        .select({
          participantName: transcripts.participantName,
          text: transcripts.text,
          startedAt: transcripts.startedAt,
        })
        .from(transcripts)
        .where(eq(transcripts.sessionId, meetingId))
        .orderBy(transcripts.startedAt)
        .all(),
      db.query.meetingSessions.findFirst({ where: eq(meetingSessions.id, meetingId) }),
    ]);

    if (!meeting || meeting.status !== "ended") {
      return { summary: null, generated: false, error: "meeting_not_ended" as const };
    }

    const archivedRows = (await loadTranscriptArchiveFromR2(env, meetingId)) ?? [];
    const resolvedRows: ResolvedTranscriptRow[] = archivedRows.length > 0
      ? archivedRows.map((row: ArchivedTranscriptRow) => ({
          participantName: row.participantName,
          text: row.text,
          startedAt: new Date(row.startedAt),
        }))
      : d1Rows;

    if (resolvedRows.length === 0) {
      return { summary: null, generated: false, error: "no_transcript" };
    }

    const transcriptText = buildTranscriptText(resolvedRows, meeting?.startedAt ?? null);

    const durationSeconds =
      meeting?.endedAt && meeting?.startedAt
        ? Math.round((meeting.endedAt.getTime() - meeting.startedAt.getTime()) / 1000)
        : null;
    const durationLabel = durationSeconds
      ? durationSeconds >= 3600
        ? `${Math.floor(durationSeconds / 3600)}h ${Math.floor((durationSeconds % 3600) / 60)}m`
        : `${Math.floor(durationSeconds / 60)}m`
      : null;
    const uniqueParticipants = new Set(
      resolvedRows.map((row: ResolvedTranscriptRow) => row.participantName),
    );
    const participantList = [...uniqueParticipants].join(", ");

    const meetingContext = [
      meeting?.title ? `Meeting: "${meeting.title}"` : null,
      durationLabel ? `Duration: ${durationLabel}` : null,
      participantList ? `Participants: ${participantList}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const google = createGoogleGenerativeAI({ apiKey: env.AI_API_KEY });
    const prompt = `Summarize the meeting transcript below into structured notes.
Speakers may mix languages — treat code-switched text as normal speech.
${meetingContext ? `\n${meetingContext}\n` : ""}
<transcript>
${transcriptText}
</transcript>`;

    let object: z.infer<typeof notesSchema> | undefined;
    for (const modelId of modelIds) {
      try {
        ({ object } = await generateObject({ model: google(modelId), schema: notesSchema, prompt }));
        break;
      } catch (err) {
        logError(`[generateMeetingNotes] model ${modelId} failed:`, err);
      }
    }
    if (!object) return { summary: null, generated: false, error: "llm_failed" };

    const [inserted] = await withD1Retry(() =>
      db
        .insert(meetingSummaries)
        .values({
          id: generateId("MEETING_SUMMARY"),
          sessionId: meetingId,
          summary: object.summary,
          topics: object.topics,
          actionItems: object.actionItems,
          decisions: object.decisions,
          durationSeconds,
          participantCount: uniqueParticipants.size,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: meetingSummaries.sessionId,
          set: {
            summary: object.summary,
            topics: object.topics,
            actionItems: object.actionItems,
            decisions: object.decisions,
            durationSeconds,
            participantCount: uniqueParticipants.size,
            createdAt: new Date(),
          },
        })
        .returning(),
    );

    // Primary purpose served: summary is generated and persisted.
    // Best-effort archive full transcript to R2 and free D1 rows.
    await archiveMeetingTranscriptsToR2(db, env, meetingId).catch((err: unknown) => {
      logError(`[generateMeetingNotes] Transcript archive failed for meeting ${meetingId}:`, err);
    });

    return {
      summary: {
        ...inserted,
        topics: object.topics,
        actionItems: object.actionItems,
        decisions: object.decisions,
      },
      generated: true,
    };
  });
