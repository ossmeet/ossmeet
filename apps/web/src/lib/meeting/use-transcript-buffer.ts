import { useRef, useEffect, useCallback } from "react";
import { saveTranscriptSegments } from "@/server/transcripts/save-client";
import { logError } from "@/lib/logger-client";

export interface BufferedSegment {
  text: string;
  participantIdentity: string;
  participantName: string;
  startedAt: number;
  language?: string;
  clientSegmentId?: string;
}

const FLUSH_INTERVAL_MS = 30_000;
const MAX_TEXT_LENGTH = 2000;

/**
 * Accumulates final transcript segments in memory and periodically flushes
 * them to the server for later note generation.
 *
 * - Flushes automatically every 30s so a crashed tab doesn't lose everything.
 * - Call flush() manually before leaveMeeting / endMeeting.
 * - Silently no-ops for guests (server rejects unauthenticated saves).
 * - On flush failure, segments are put back so the next flush retries them.
 *
 * `addSegment` is for the local user's speech.
 * `addRemoteSegment` is for remote participants' speech received via captions.
 */
export function useTranscriptBuffer({
  meetingId,
  participantIdentity,
  participantName,
}: {
  meetingId: string | null;
  participantIdentity: string | undefined;
  participantName: string | undefined;
}) {
  const pendingRef = useRef<BufferedSegment[]>([]);
  const seenIdsRef = useRef(new Map<string, number>());
  const MAX_SEEN_IDS = 1000;

  // Keep latest values accessible in callbacks without causing re-renders
  const meetingIdRef = useRef(meetingId);
  const identityRef = useRef(participantIdentity);
  const nameRef = useRef(participantName);
  meetingIdRef.current = meetingId;
  identityRef.current = participantIdentity;
  nameRef.current = participantName;

  const flush = useCallback(async (): Promise<void> => {
    const mid = meetingIdRef.current;
    if (!mid || pendingRef.current.length === 0) return;

    const segments = pendingRef.current.splice(0);
    try {
      await saveTranscriptSegments({ data: { sessionId: mid, segments } });
    } catch (err) {
      // Put segments back so the next flush retries them
      pendingRef.current.unshift(...segments);
      logError("[TranscriptBuffer] flush failed:", err);
    }
  }, []);

  const addSegment = useCallback((
    text: string,
    meta?: { startedAt?: number; language?: string; segmentId?: string }
  ): void => {
    const identity = identityRef.current;
    const name = nameRef.current;
    if (!identity || !name || !meetingIdRef.current) return;

    const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
    if (!trimmed) return;

    const segmentId = meta?.segmentId;
    if (segmentId) {
      if (seenIdsRef.current.has(segmentId)) return;
      if (seenIdsRef.current.size >= MAX_SEEN_IDS) {
        const oldest = seenIdsRef.current.keys().next().value;
        if (oldest !== undefined) seenIdsRef.current.delete(oldest);
      }
      seenIdsRef.current.set(segmentId, Date.now());
    }

    pendingRef.current.push({
      text: trimmed,
      participantIdentity: identity,
      participantName: name,
      startedAt: meta?.startedAt ?? Date.now(),
      language: meta?.language,
      clientSegmentId: segmentId,
    });
  }, []);

  /**
   * Add a transcript segment from a remote participant (received via captions).
   * Deduplicates by segmentId to avoid double-saving if two participants'
   * clients both receive each other's captions.
   */
  const addRemoteSegment = useCallback((
    identity: string,
    name: string,
    text: string,
    meta?: { startedAt?: number; language?: string; segmentId?: string }
  ): void => {
    if (!meetingIdRef.current) return;

    const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
    if (!trimmed) return;

    const segmentId = meta?.segmentId;
    if (segmentId) {
      if (seenIdsRef.current.has(segmentId)) return;
      if (seenIdsRef.current.size >= MAX_SEEN_IDS) {
        const oldest = seenIdsRef.current.keys().next().value;
        if (oldest !== undefined) seenIdsRef.current.delete(oldest);
      }
      seenIdsRef.current.set(segmentId, Date.now());
    }

    pendingRef.current.push({
      text: trimmed,
      participantIdentity: identity,
      participantName: name,
      startedAt: meta?.startedAt ?? Date.now(),
      language: meta?.language,
      clientSegmentId: segmentId,
    });
  }, []);

  // Auto-flush every 30s
  useEffect(() => {
    const timer = setInterval(() => {
      void flush();
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [flush]);

  return { addSegment, addRemoteSegment, flush };
}
