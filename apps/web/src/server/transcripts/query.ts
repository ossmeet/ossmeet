import type { Database } from "@ossmeet/db";
import { transcripts } from "@ossmeet/db/schema";
import { and, asc, eq, gt, or } from "drizzle-orm";

const TRANSCRIPT_BATCH_SIZE = 1000;

export type TranscriptListRow = {
  id: string;
  participantIdentity: string;
  participantName: string;
  text: string;
  language: string | null;
  startedAt: Date;
};

export async function listTranscriptRows(db: Database, sessionId: string): Promise<TranscriptListRow[]> {
  const rows: TranscriptListRow[] = [];
  let cursor: { startedAt: Date; id: string } | null = null;

  while (true) {
    const batch: TranscriptListRow[] = await db
      .select({
        id: transcripts.id,
        participantIdentity: transcripts.participantIdentity,
        participantName: transcripts.participantName,
        text: transcripts.text,
        language: transcripts.language,
        startedAt: transcripts.startedAt,
      })
      .from(transcripts)
      .where(
        and(
          eq(transcripts.sessionId, sessionId),
          cursor
            ? or(
                gt(transcripts.startedAt, cursor.startedAt),
                and(eq(transcripts.startedAt, cursor.startedAt), gt(transcripts.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(asc(transcripts.startedAt), asc(transcripts.id))
      .limit(TRANSCRIPT_BATCH_SIZE)
      .all();

    rows.push(...batch);
    if (batch.length < TRANSCRIPT_BATCH_SIZE) {
      return rows;
    }

    const last: TranscriptListRow | undefined = batch[batch.length - 1];
    if (!last) return rows;
    cursor = { startedAt: last.startedAt, id: last.id };
  }
}
