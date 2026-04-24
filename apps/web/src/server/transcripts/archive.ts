import type { Database } from "@ossmeet/db";
import { transcripts } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { logError } from "@/lib/logger";

export type ArchivedTranscriptRow = {
  id: string;
  participantIdentity: string;
  participantName: string;
  text: string;
  language: string | null;
  startedAt: string;
};

type TranscriptArchivePayload = {
  version: 1;
  meetingId: string;
  archivedAt: string;
  transcripts: ArchivedTranscriptRow[];
};

export function transcriptArchiveKey(meetingId: string): string {
  return `transcripts/${meetingId}/full.json`;
}

export async function loadTranscriptArchiveFromR2(
  env: Pick<Env, "R2_BUCKET">,
  meetingId: string,
): Promise<ArchivedTranscriptRow[] | null> {
  try {
    const object = await env.R2_BUCKET.get(transcriptArchiveKey(meetingId));
    if (!object) return null;
    const payload = (await object.json()) as Partial<TranscriptArchivePayload>;
    if (!payload || payload.version !== 1 || !Array.isArray(payload.transcripts)) {
      return null;
    }
    return payload.transcripts.filter((row): row is ArchivedTranscriptRow => (
      !!row &&
      typeof row.id === "string" &&
      typeof row.participantIdentity === "string" &&
      typeof row.participantName === "string" &&
      typeof row.text === "string" &&
      (typeof row.language === "string" || row.language === null) &&
      typeof row.startedAt === "string"
    ));
  } catch (err) {
    logError(`[transcripts] Failed to load archive for meeting ${meetingId}:`, err);
    return null;
  }
}

export async function archiveMeetingTranscriptsToR2(
  db: Database,
  env: Pick<Env, "R2_BUCKET">,
  meetingId: string,
): Promise<{ archived: boolean; deletedRows: number }> {
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
    .orderBy(transcripts.startedAt);

  if (rows.length === 0) {
    return { archived: false, deletedRows: 0 };
  }

  const payload: TranscriptArchivePayload = {
    version: 1,
    meetingId,
    archivedAt: new Date().toISOString(),
    transcripts: rows.map((row) => ({
      ...row,
      startedAt: row.startedAt.toISOString(),
    })),
  };

  await env.R2_BUCKET.put(transcriptArchiveKey(meetingId), JSON.stringify(payload), {
    httpMetadata: { contentType: "application/json" },
  });

  await db.delete(transcripts).where(eq(transcripts.sessionId, meetingId));
  return { archived: true, deletedRows: rows.length };
}
