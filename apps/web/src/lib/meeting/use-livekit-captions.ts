import { useCallback, useEffect, useRef, useState } from "react";
import type { Participant, Room } from "livekit-client";
import { ConnectionState, RoomEvent } from "livekit-client";
import { logError } from "@/lib/logger-client";
import { isExpectedClosedPublishError } from "./livekit-helpers";
import { LIVEKIT_TOPICS, MESSAGE_LIMITS } from "./constants";
import { ReceiverRateLimiter } from "./receiver-rate-limiter";
import type { SpeechTranscriptMeta } from "./use-speech-recognition";

/**
 * One visible caption line per active speaker.
 *
 * Lifecycle: each speaker has at most one entry. Interim updates overwrite
 * it; a `final` entry replaces and then expires after `CAPTION_TTL_MS`.
 */
export interface CaptionLine {
  userId: string;
  userName: string;
  text: string;
  isFinal: boolean;
  updatedAt: number;
  language?: string;
}

type CaptionMessage =
  {
    v: 1;
    kind: "caption";
    text: string;
    isFinal: boolean;
    language?: string;
    segmentId?: string;
  };

const CAPTION_TTL_MS = 4_000;
const INTERIM_PUBLISH_INTERVAL_MS = 350;
const MAX_INTERIM_DELTA = 80; // chars: don't spam tiny updates either
const CAPTION_RECEIVE_MAX_RATE = 5;
const CAPTION_RECEIVE_WINDOW_MS = 1_000;

/**
 * Sends and receives live captions over a LiveKit data-channel topic.
 *
 * Design:
 * - Each participant transcribes only their own mic via Web Speech API
 *   (handled by the caller), then publishes those results to everyone.
 * - `isFinal` segments are sent reliably; interim segments are sent
 *   unreliably and throttled to ~3/sec to avoid flooding.
 * - The local overlay echo follows the same throttle as remote publish,
 *   so the speaker and the listeners see captions update at the same cadence.
 * - Finals are de-duplicated by `segmentId` per speaker so a flaky
 *   transmitter that re-sends the same final doesn't reset the TTL.
 * - The caller decides whether captions are displayed. Publishing still
 *   happens when captions are hidden so post-meeting transcripts stay complete.
 */
export function useLiveKitCaptions(room: Room | undefined) {
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const expiryTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastFinalSegmentRef = useRef(new Map<string, string>());
  const lastInterimPublishRef = useRef(0);
  const lastInterimTextRef = useRef("");
  const receiverLimiterRef = useRef(
    new ReceiverRateLimiter(CAPTION_RECEIVE_MAX_RATE, CAPTION_RECEIVE_WINDOW_MS),
  );
  const roomRef = useRef(room);
  roomRef.current = room;

  const removeCaption = useCallback((userId: string) => {
    setCaptions((prev) => prev.filter((c) => c.userId !== userId));
    const timer = expiryTimersRef.current.get(userId);
    if (timer) clearTimeout(timer);
    expiryTimersRef.current.delete(userId);
    lastFinalSegmentRef.current.delete(userId);
  }, []);

  const upsertCaption = useCallback(
    (line: CaptionLine) => {
      setCaptions((prev) => {
        const idx = prev.findIndex((c) => c.userId === line.userId);
        if (idx === -1) return [...prev, line];
        const next = prev.slice();
        next[idx] = line;
        return next;
      });

      const existing = expiryTimersRef.current.get(line.userId);
      if (existing) clearTimeout(existing);
      expiryTimersRef.current.set(
        line.userId,
        setTimeout(() => removeCaption(line.userId), CAPTION_TTL_MS),
      );
    },
    [removeCaption],
  );

  const sendCaption = useCallback(
    (text: string, isFinal: boolean, meta?: SpeechTranscriptMeta) => {
      const currentRoom = roomRef.current;
      if (!currentRoom || currentRoom.state !== ConnectionState.Connected) return;

      const lp = currentRoom.localParticipant;
      const userId = lp.identity;
      const userName = lp.name || lp.identity;
      if (!userId || !userName) return;

      const trimmed = text.trim().slice(0, MESSAGE_LIMITS.MAX_CAPTION_LENGTH);
      if (!trimmed) return;

      const now = Date.now();

      // Throttle interim publishes — and skip the local overlay update too,
      // so the speaker sees the same cadence as everyone else.
      if (!isFinal) {
        const delta = Math.abs(trimmed.length - lastInterimTextRef.current.length);
        const stale = now - lastInterimPublishRef.current >= INTERIM_PUBLISH_INTERVAL_MS;
        if (!stale && delta < MAX_INTERIM_DELTA) return;
        lastInterimPublishRef.current = now;
        lastInterimTextRef.current = trimmed;
      } else {
        lastInterimTextRef.current = "";
        // De-dup re-published finals (same segmentId for this speaker).
        const segmentId = meta?.segmentId;
        if (segmentId) {
          const last = lastFinalSegmentRef.current.get(userId);
          if (last === segmentId) return;
          lastFinalSegmentRef.current.set(userId, segmentId);
        }
      }

      // Local echo: speaker sees their own caption immediately.
      upsertCaption({
        userId,
        userName,
        text: trimmed,
        isFinal,
        updatedAt: now,
        language: meta?.language,
      });

      const event: CaptionMessage = {
        v: 1,
        kind: "caption",
        text: trimmed,
        isFinal,
        language: meta?.language,
        segmentId: meta?.segmentId,
      };
      const payload = new TextEncoder().encode(JSON.stringify(event));

      lp.publishData(payload, {
        reliable: isFinal,
        topic: LIVEKIT_TOPICS.CAPTIONS,
      }).catch((err) => {
        if (isExpectedClosedPublishError(err)) return;
        logError("[LiveKitCaptions] publishData failed:", err);
      });
    },
    [upsertCaption],
  );

  // Receive incoming captions from other participants.
  useEffect(() => {
    if (!room) return;

    const handleData = (
      payload: Uint8Array,
      participant?: { identity?: string; name?: string },
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== LIVEKIT_TOPICS.CAPTIONS) return;
      const senderId = participant?.identity;
      if (!senderId || senderId === room.localParticipant?.identity) return;
      if (!receiverLimiterRef.current.shouldAllow(senderId)) return;

      let event: CaptionMessage;
      try {
        event = JSON.parse(new TextDecoder().decode(payload)) as CaptionMessage;
      } catch (err) {
        logError("[LiveKitCaptions] parse failed:", err);
        return;
      }
      if (!event || event.v !== 1) return;
      if (event.kind !== "caption" || typeof event.text !== "string") return;

      // De-dup re-published finals from a flaky remote transmitter.
      if (event.isFinal && event.segmentId) {
        const last = lastFinalSegmentRef.current.get(senderId);
        if (last === event.segmentId) return;
        lastFinalSegmentRef.current.set(senderId, event.segmentId);
      }

      upsertCaption({
        userId: senderId,
        userName: participant?.name || senderId,
        text: event.text.slice(0, MESSAGE_LIMITS.MAX_CAPTION_LENGTH),
        isFinal: !!event.isFinal,
        updatedAt: Date.now(),
        language: event.language,
      });
    };

    const handleParticipantDisconnected = (participant: Participant) => {
      const id = participant.identity;
      if (!id) return;
      removeCaption(id);
    };

    room.on(RoomEvent.DataReceived, handleData);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    };
  }, [room, upsertCaption, removeCaption]);

  // Drop everything when the room goes away or this hook unmounts.
  useEffect(() => {
    if (!room) setCaptions([]);
    return () => {
      for (const t of expiryTimersRef.current.values()) clearTimeout(t);
      expiryTimersRef.current.clear();
      lastFinalSegmentRef.current.clear();
    };
  }, [room]);

  return {
    captions,
    sendCaption,
  };
}
