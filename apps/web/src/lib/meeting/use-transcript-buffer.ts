import { useCallback, useEffect, useRef, useState } from "react";
import { saveTranscriptSegments } from "@/server/transcripts/save-client";
import { logError } from "@/lib/logger-client";

export interface BufferedSegment {
  text: string;
  startedAt: number;
  language?: string;
  clientSegmentId?: string;
}

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_SIZE = 50;
const MAX_TEXT_LENGTH = 2_000;
const MAX_SEEN_IDS = 1_000;

/**
 * Buffers final transcript segments locally and flushes them to D1.
 *
 * - Auto-flushes every 5s while data is pending.
 * - On `pagehide`, attempts a `sendBeacon` flush so an unmounting tab
 *   still persists its tail. The server function is also reachable via
 *   normal POST for the regular flush path.
 * - Same `clientSegmentId` is never queued twice (de-dups Web Speech
 *   re-publishes within a session).
 * - Includes admission/connection IDs so the server can persist verified
 *   guest speech without trusting client-supplied identity/name fields.
 */
export function useTranscriptBuffer({
  meetingId,
  admissionId,
  connectionId,
  participantIdentity,
  participantName,
}: {
  meetingId: string | null;
  admissionId?: string | null;
  connectionId?: string | null;
  participantIdentity: string | undefined;
  participantName: string | undefined;
}) {
  const meetingIdRef = useRef(meetingId);
  const admissionIdRef = useRef(admissionId);
  const connectionIdRef = useRef(connectionId);
  const identityRef = useRef(participantIdentity);
  const nameRef = useRef(participantName);
  meetingIdRef.current = meetingId;
  admissionIdRef.current = admissionId;
  connectionIdRef.current = connectionId;
  identityRef.current = participantIdentity;
  nameRef.current = participantName;

  const pendingRef = useRef<BufferedSegment[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isFlushing, setIsFlushing] = useState(false);
  const [lastFlushFailed, setLastFlushFailed] = useState(false);

  const syncPendingCount = useCallback(() => {
    setPendingCount(pendingRef.current.length);
  }, []);

  const flush = useCallback(async () => {
    const sessionId = meetingIdRef.current;
    if (!sessionId || pendingRef.current.length === 0) return;
    if (inFlightRef.current) {
      queuedRef.current = true;
      return;
    }

    inFlightRef.current = true;
    setIsFlushing(true);
    try {
      while (pendingRef.current.length > 0) {
        const batch = pendingRef.current.splice(0, FLUSH_BATCH_SIZE);
        syncPendingCount();
        try {
          await saveTranscriptSegments({
            data: {
              sessionId,
              admissionId: admissionIdRef.current ?? undefined,
              connectionId: connectionIdRef.current ?? undefined,
              segments: batch,
            },
          });
          setLastFlushFailed(false);
        } catch (err) {
          // Put back for next round; keep the order.
          pendingRef.current = [...batch, ...pendingRef.current];
          syncPendingCount();
          setLastFlushFailed(true);
          logError("[TranscriptBuffer] flush failed:", err);
          break;
        }
      }
    } finally {
      inFlightRef.current = false;
      setIsFlushing(false);
      if (queuedRef.current) {
        queuedRef.current = false;
        if (pendingRef.current.length > 0) void flush();
      }
    }
  }, [syncPendingCount]);

  const addSegment = useCallback(
    (text: string, meta?: { startedAt?: number; language?: string; segmentId?: string }) => {
      if (!identityRef.current || !nameRef.current || !meetingIdRef.current) return;

      const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
      if (!trimmed) return;

      const segmentId = meta?.segmentId;
      if (segmentId) {
        if (seenIdsRef.current.has(segmentId)) return;
        if (seenIdsRef.current.size >= MAX_SEEN_IDS) {
          // Cheap eviction: drop the first inserted entry.
          const first = seenIdsRef.current.values().next().value;
          if (first !== undefined) seenIdsRef.current.delete(first);
        }
        seenIdsRef.current.add(segmentId);
      }

      pendingRef.current.push({
        text: trimmed,
        startedAt: meta?.startedAt ?? Date.now(),
        language: meta?.language,
        clientSegmentId: segmentId,
      });
      syncPendingCount();
    },
    [syncPendingCount],
  );

  // Periodic flush.
  useEffect(() => {
    const timer = setInterval(() => {
      if (pendingRef.current.length > 0) void flush();
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [flush]);

  // Best-effort flush when the tab is going away. We can't reliably use
  // sendBeacon (TanStack server-fn URLs aren't stable), so just kick a
  // normal flush and accept that the tail (≤ FLUSH_INTERVAL_MS of speech)
  // may be lost on hard tab close. The leave/end button paths already
  // call flush() explicitly.
  useEffect(() => {
    const onPageHide = () => {
      if (pendingRef.current.length > 0) void flush();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [flush]);

  return { addSegment, flush, pendingCount, isFlushing, lastFlushFailed };
}
