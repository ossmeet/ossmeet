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
import { chat } from "@tanstack/ai";
import { createGeminiTextAdapter } from "../ai/gemini";
import { logError } from "@/lib/logger";
import { withD1Retry } from "@/lib/db-utils";
import { canAccessMeetingTranscriptData } from "./access";
import { authMiddleware } from "../middleware";

// Schema we ask Gemini to fill in.
const notesSchema = z.object({
  summary: z
    .string()
    .max(MEETING_NOTES_SUMMARY_MAX_LENGTH)
    .describe(
      "2–4 sentence overview describing what was actually discussed and the outcome. Concrete, not generic. Skip greetings and small talk.",
    ),
  topics: z
    .array(z.string().max(MEETING_NOTES_TOPIC_MAX_LENGTH))
    .max(MEETING_NOTES_TOPIC_MAX_ITEMS)
    .describe(
      "Substantive subjects discussed, as short noun phrases (no verbs, no full sentences). Empty array if nothing substantive was discussed.",
    ),
  actionItems: z
    .array(z.string().max(MEETING_NOTES_DETAIL_MAX_LENGTH))
    .max(MEETING_NOTES_DETAIL_MAX_ITEMS)
    .describe(
      "Concrete next steps that were actually agreed to. Format as 'Person: task' when an owner is clear in the transcript; otherwise state the task plainly. Do not include casual mentions or hypotheticals. Empty array if none.",
    ),
  decisions: z
    .array(z.string().max(MEETING_NOTES_DETAIL_MAX_LENGTH))
    .max(MEETING_NOTES_DETAIL_MAX_ITEMS)
    .describe(
      "Explicit choices made during the meeting (e.g. 'Chose Postgres over MySQL', 'Postponed launch to Q3'). Do not invent decisions that were only discussed. Empty array if none.",
    ),
});

// Consecutive segments from the same speaker within this gap merge into a
// single turn. Tighter than ad-hoc speech segments so the LLM gets a clean
// dialogue rather than fragments.
const SAME_SPEAKER_MERGE_GAP_MS = 30_000;

// Skip the LLM call if the merged transcript has fewer than this many chars
// of substantive speech — the model will produce hallucinated or empty notes.
const MIN_TRANSCRIPT_CHARS = 250;

interface ResolvedTranscriptRow {
  participantName: string;
  text: string;
  startedAt: Date;
}

/**
 * Format transcript rows as `[mm:ss Speaker]: text` lines, merging adjacent
 * segments from the same speaker. The relative timestamp is from the meeting
 * start (or first segment if start time is unknown).
 */
function buildTranscriptText(rows: ResolvedTranscriptRow[], meetingStartedAt: Date | null): string {
  if (rows.length === 0) return "";
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
      if (cur.participantName !== speaker) break;
      if (cur.startedAt.getTime() - prevMs >= SAME_SPEAKER_MERGE_GAP_MS) break;
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
 * Generate AI meeting notes for an ended meeting using Gemini.
 *
 * Idempotent: if a summary already exists for this meeting it is returned
 * without re-calling the LLM. Tries `AI_MODEL` first, then `AI_MODEL_FALLBACK`.
 *
 * Returns one of:
 *  - `{ summary, generated: true|false }`
 *  - `{ summary: null, generated: false, error: "ai_not_configured"
 *      | "no_transcript" | "meeting_not_ended" | "llm_failed" }`
 */
export async function generateMeetingNotesForSession(
  db: import("@ossmeet/db").Database,
  env: Env,
  meetingId: string,
) {
  // Already generated → return cached.
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
    return { summary: null, generated: false, error: "ai_not_configured" as const };
  }

  const meeting = await db.query.meetingSessions.findFirst({
    where: eq(meetingSessions.id, meetingId),
  });
  if (!meeting || meeting.status !== "ended") {
    return { summary: null, generated: false, error: "meeting_not_ended" as const };
  }

  const rows = await db
    .select({
      participantName: transcripts.participantName,
      text: transcripts.text,
      startedAt: transcripts.startedAt,
    })
    .from(transcripts)
    .where(eq(transcripts.sessionId, meetingId))
    .orderBy(transcripts.startedAt)
    .all();

  const transcriptText = buildTranscriptText(rows, meeting.startedAt ?? null);
  if (transcriptText.trim().length < MIN_TRANSCRIPT_CHARS) {
    return { summary: null, generated: false, error: "no_transcript" as const };
  }

  const durationSeconds =
    meeting.endedAt && meeting.startedAt
      ? Math.round((meeting.endedAt.getTime() - meeting.startedAt.getTime()) / 1000)
      : null;
  const durationLabel = durationSeconds
    ? durationSeconds >= 3600
      ? `${Math.floor(durationSeconds / 3600)}h ${Math.floor((durationSeconds % 3600) / 60)}m`
      : `${Math.floor(durationSeconds / 60)}m`
    : null;
  const uniqueParticipants = new Set(rows.map((row) => row.participantName));
  const participantList = [...uniqueParticipants].join(", ");

  const meetingContext = [
    meeting.title ? `Meeting: "${meeting.title}"` : null,
    durationLabel ? `Duration: ${durationLabel}` : null,
    participantList ? `Participants: ${participantList}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You are summarizing a real meeting transcript into structured notes. Someone who missed the meeting should be able to read your output in under a minute and understand what happened and what to do next.

Transcript characteristics:
- The text comes from each participant's own browser speech-recognition, configured per user. Different speakers may therefore be recognized in different languages within the same meeting (e.g. Alice in English, Bob in Spanish). Treat every speaker's line as a single, coherent utterance in their own language.
- Expect typos, missing punctuation, dropped words, and half-finished sentences from speech recognition. Interpret charitably and infer intent from context.
- Speaker names are exact. Use them verbatim when attributing actions, decisions, or quotes.
- Each line is prefixed with [mm:ss SpeakerName]. Use the order to follow the flow of discussion. Do not include timestamps in your output.

Be faithful to the transcript:
- Only include actions and decisions that were actually agreed to, not things that were merely floated or asked about.
- Do not invent facts, owners, dates, numbers, or outcomes that are not supported by the transcript.
- If a field has nothing genuine to report, return an empty array rather than padding with filler.
- Write the output in clear, neutral English even when speakers used other languages. Translate quotes and key terms as needed.${meetingContext ? `\n\n${meetingContext}` : ""}

<transcript>
${transcriptText}
</transcript>`;

  const modelIds = [env.AI_MODEL, env.AI_MODEL_FALLBACK].filter(Boolean) as string[];

  let object: z.infer<typeof notesSchema> | undefined;
  for (const modelId of modelIds) {
    try {
      object = await chat({
        adapter: createGeminiTextAdapter(modelId, env.AI_API_KEY),
        outputSchema: notesSchema,
        messages: [{ role: "user", content: prompt }],
      });
      break;
    } catch (err) {
      logError(`[generateMeetingNotes] model ${modelId} failed:`, err);
    }
  }
  if (!object) return { summary: null, generated: false, error: "llm_failed" as const };

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

  return {
    summary: {
      ...inserted,
      topics: object.topics,
      actionItems: object.actionItems,
      decisions: object.decisions,
    },
    generated: true,
  };
}

export const generateMeetingNotes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ meetingId: z.string().min(1) }))
  .handler(async ({ data, context: { user, db, env } }) => {
    const allowed = await canAccessMeetingTranscriptData(db, data.meetingId, user.id);
    if (!allowed) throw Errors.FORBIDDEN();
    return generateMeetingNotesForSession(db, env, data.meetingId);
  });
