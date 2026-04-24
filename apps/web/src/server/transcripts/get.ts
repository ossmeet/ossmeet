import { createServerFn } from "@tanstack/react-start";
import { transcripts } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { Errors } from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import { canAccessMeetingTranscriptData } from "./access";
import type { ArchivedTranscriptRow } from "./archive";

const ARCHIVE_MODULE = "./archive";

const getTranscriptsSchema = z.object({
  meetingId: z.string().min(1),
});

/**
 * Fetch all transcripts for a meeting. Requires auth.
 * Returns chronological transcript lines for post-meeting recap.
 */
export const getMeetingTranscripts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(getTranscriptsSchema)
  .handler(async ({ data, context: { user, db, env } }) => {
    const { loadTranscriptArchiveFromR2 } = await import(/* @vite-ignore */ ARCHIVE_MODULE);
    const { meetingId } = data;

    const allowed = await canAccessMeetingTranscriptData(db, meetingId, user.id);
    if (!allowed) throw Errors.FORBIDDEN();

    const rows = await db
      .select({
        id: transcripts.id,
        participantIdentity: transcripts.participantIdentity,
        participantName: transcripts.participantName,
        text: transcripts.text,
        language: transcripts.language,
        startedAt: transcripts.startedAt,
      })
      .from(transcripts)
      .where(eq(transcripts.sessionId, meetingId))
      .orderBy(transcripts.startedAt)
      // TODO: implement cursor-based pagination (callers currently expect full list)
      .limit(10_000)
      .all();

    if (rows.length > 0) {
      return { transcripts: rows };
    }

    const archived = await loadTranscriptArchiveFromR2(env, meetingId);
    if (archived && archived.length > 0) {
      return {
        transcripts: archived.map((row: ArchivedTranscriptRow) => ({
          id: row.id,
          participantIdentity: row.participantIdentity,
          participantName: row.participantName,
          text: row.text,
          language: row.language,
          startedAt: new Date(row.startedAt),
        })),
      };
    }

    return { transcripts: rows };
  });
