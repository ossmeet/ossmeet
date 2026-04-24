import { useEffect, useCallback, useState, useRef } from "react";
import type { Room, Participant } from "livekit-client";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import { logError } from "@/lib/logger-client";
import { isExpectedClosedPublishError } from "./livekit-helpers";
import { MESSAGE_LIMITS, LIVEKIT_TOPICS } from "./constants";
import { useTokenBucket } from "./use-token-bucket";
import { ReceiverRateLimiter } from "./receiver-rate-limiter";
import type { SpeechTranscriptMeta } from "./use-speech-recognition";

// Caption rate limit: 8 tokens, 3 tokens/sec refill — sized to keep up with
// Web Speech API interim results (~3-5/sec) without starving final results
const CAPTION_BUCKET_CAPACITY = 8;
const CAPTION_BUCKET_REFILL_RATE = 3;

// How long a caption stays visible after last update (ms)
const CAPTION_DISPLAY_DURATION = 4000;

// How long "speaking but untranscribable" stays visible (ms)
const SPEAKING_INDICATOR_DURATION = 3000;

// Minimum interval between network publishes for "untranscribable" signals (ms).
// The local indicator updates on every call, but we avoid flooding data channels
// with redundant "speaking but unsupported" events.
const UNTRANSCRIBABLE_PUBLISH_INTERVAL = 8000;

/**
 * Caption event sent via LiveKit data channels
 */
export interface CaptionEvent {
  type: "caption";
  userId: string;
  userName: string;
  /** The transcribed text segment */
  text: string;
  /** True when the speech recognition result is final */
  isFinal: boolean;
  /** Whether the sender's browser supports speech recognition */
  speechSupported: boolean;
  timestamp: number;
  segmentId?: string;
  language?: string;
  startedAt?: number;
}

/**
 * A visible caption line in the overlay
 */
export interface CaptionLine {
  userId: string;
  userName: string;
  text: string;
  isFinal: boolean;
  /** If false, the participant is speaking but their browser can't transcribe */
  speechSupported: boolean;
  updatedAt: number;
  segmentId?: string;
  language?: string;
}

export interface CaptionHistoryLine extends CaptionLine {
  segmentId: string;
  startedAt: number;
}

/**
 * Hook for sending/receiving closed captions via LiveKit Data Channels.
 *
 * Senders publish their speech transcript (or a "speaking but unsupported" signal).
 * Receivers collect and display caption lines per participant, with auto-expiry.
 */
export function useLiveKitCaptions(
  room: Room | undefined,
  userId?: string,
  userName?: string,
  /** Whether the local browser supports Web Speech API */
  localSpeechSupported = true,
  /** Called when a remote participant's final caption is received */
  onRemoteCaption?: (identity: string, name: string, text: string, meta: { startedAt?: number; language?: string; segmentId?: string }) => void
) {
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [captionHistory, setCaptionHistory] = useState<CaptionHistoryLine[]>([]);
  const roomRef = useRef(room);
  const userIdRef = useRef(userId);
  const userNameRef = useRef(userName);
  const localSpeechSupportedRef = useRef(localSpeechSupported);
  roomRef.current = room;
  userIdRef.current = userId;
  userNameRef.current = userName;
  localSpeechSupportedRef.current = localSpeechSupported;

  const onRemoteCaptionRef = useRef(onRemoteCaption);
  onRemoteCaptionRef.current = onRemoteCaption;

  const { consume } = useTokenBucket(
    CAPTION_BUCKET_CAPACITY,
    CAPTION_BUCKET_REFILL_RATE
  );

  // Expiry timers per userId
  const expiryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Tracks the last time the local participant was the dominant active speaker.
  // Used to gate caption sends: the Web Speech API uses the raw mic (no echo
  // cancellation), so it can transcribe remote audio leaking through speakers.
  // LiveKit's isSpeaking uses the echo-cancelled stream and is more reliable.
  const lastLocalDominantSpeakerAtRef = useRef<number>(0);
  const lastMicSpeechAtRef = useRef<number>(0);
  const micProofAvailableRef = useRef(false);

  // Tracks last time we published an "untranscribable" event over the network.
  // Used to throttle redundant publishes after the first one.
  const lastUntranscribablePublishRef = useRef<number>(0);

  const removeCaptionForUser = useCallback((uid: string) => {
    setCaptions((prev) => prev.filter((c) => c.userId !== uid));
    const timer = expiryTimersRef.current.get(uid);
    if (timer) {
      clearTimeout(timer);
      expiryTimersRef.current.delete(uid);
    }
  }, []);

  const resetExpiryTimer = useCallback(
    (uid: string, duration: number) => {
      const existing = expiryTimersRef.current.get(uid);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        removeCaptionForUser(uid);
      }, duration);
      expiryTimersRef.current.set(uid, timer);
    },
    [removeCaptionForUser]
  );

  /**
   * Upsert a caption line into state and reset its expiry timer.
   */
  const upsertCaption = useCallback(
    (line: CaptionLine, duration: number) => {
      setCaptions((prev) => {
        const exists = prev.some((c) => c.userId === line.userId);
        if (exists) {
          return prev.map((c) => (c.userId === line.userId ? line : c));
        }
        const next = [...prev, line];
        return next.length > 10 ? next.slice(-10) : next;
      });
      resetExpiryTimer(line.userId, duration);
    },
    [resetExpiryTimer]
  );

  const appendHistory = useCallback((line: CaptionHistoryLine) => {
    setCaptionHistory((prev) => {
      const exists = prev.some(
        (existing) =>
          existing.segmentId === line.segmentId &&
          existing.userId === line.userId
      );
      const next = exists
        ? prev.map((existing) =>
            existing.segmentId === line.segmentId && existing.userId === line.userId
              ? line
              : existing
          )
        : [...prev, line];
      return next.length > 300 ? next.slice(-300) : next;
    });
  }, []);

  const isLocalSpeechOwned = useCallback(() => {
    const currentRoom = roomRef.current;
    const lp = currentRoom?.localParticipant;
    if (!lp?.isMicrophoneEnabled) return false;

    const now = Date.now();
    const liveKitDominant =
      lp.isSpeaking || now - lastLocalDominantSpeakerAtRef.current < 2500;
    const micLevelMatches =
      !micProofAvailableRef.current || now - lastMicSpeechAtRef.current < 2500;

    return liveKitDominant && micLevelMatches;
  }, []);

  /**
   * Send a caption (transcript text) to all participants.
   * Also displays the caption locally so the speaker sees their own text.
   * Returns false when local speaker ownership cannot be proven.
   */
  const sendCaption = useCallback(
    (text: string, isFinal: boolean, meta?: SpeechTranscriptMeta): boolean => {
      const currentRoom = roomRef.current;
      if (!currentRoom || currentRoom.state !== ConnectionState.Connected)
        return false;

      const lp = currentRoom.localParticipant;
      const resolvedUserId = lp.identity || userIdRef.current;
      const resolvedUserName = lp.name || lp.identity || userNameRef.current;
      if (!resolvedUserId || !resolvedUserName) return false;

      // Gate on mic state and speaking activity.
      // The Web Speech API uses the raw mic (no echo cancellation) so it can
      // transcribe remote audio leaking through speakers. LiveKit's speaker
      // detection uses the echo-cancelled stream and is more reliable.
      if (!lp.isMicrophoneEnabled) return false;
      const now = Date.now();
      const liveKitDominant = lp.isSpeaking || now - lastLocalDominantSpeakerAtRef.current < 2500;
      const micLevelMatches = !micProofAvailableRef.current || now - lastMicSpeechAtRef.current < 2500;
      if (!liveKitDominant || !micLevelMatches) return false;

      const trimmedText = text.slice(0, MESSAGE_LIMITS.MAX_CAPTION_LENGTH);
      const segmentId = meta?.segmentId ?? `local:${resolvedUserId}:${now}`;

      // Always show locally so the speaker sees their own text immediately
      upsertCaption(
        {
          userId: resolvedUserId,
          userName: resolvedUserName,
          text: trimmedText,
          isFinal,
          speechSupported: true,
          updatedAt: now,
          segmentId,
          language: meta?.language,
        },
        isFinal ? CAPTION_DISPLAY_DURATION : CAPTION_DISPLAY_DURATION * 2
      );
      if (isFinal) {
        appendHistory({
          userId: resolvedUserId,
          userName: resolvedUserName,
          text: trimmedText,
          isFinal: true,
          speechSupported: true,
          updatedAt: now,
          segmentId,
          language: meta?.language,
          startedAt: meta?.startedAt ?? now,
        });
      }

      // Rate-limit outgoing publishes (local display is unaffected)
      if (!consume()) return true;

      const event: CaptionEvent = {
        type: "caption",
        userId: resolvedUserId,
        userName: resolvedUserName,
        text: trimmedText,
        isFinal,
        speechSupported: localSpeechSupportedRef.current,
        timestamp: now,
        segmentId,
        language: meta?.language,
        startedAt: meta?.startedAt,
      };

      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(event));

      // Use reliable delivery for final transcripts so they aren't lost
      void currentRoom.localParticipant
        .publishData(data, {
          reliable: isFinal,
          topic: LIVEKIT_TOPICS.CAPTIONS,
        })
        .catch((err) => {
          if (isExpectedClosedPublishError(err)) return;
          logError("[LiveKitCaptions] publishData failed:", err);
        });
      return true;
    },
    [appendHistory, consume, isLocalSpeechOwned, upsertCaption]
  );

  /**
   * Send a "speaking but untranscribable" signal.
   * Called when the user's mic is active but their browser doesn't support
   * Web Speech API.
   */
  const sendUntranscribable = useCallback(() => {
    const currentRoom = roomRef.current;
    if (!currentRoom || currentRoom.state !== ConnectionState.Connected) return;

    const lp = currentRoom.localParticipant;
    const resolvedUserId = lp.identity || userIdRef.current;
    const resolvedUserName = lp.name || lp.identity || userNameRef.current;
    if (!resolvedUserId || !resolvedUserName) return;

    const now = Date.now();

    // Always update the local indicator (short expiry, visual feedback)
    upsertCaption(
      {
        userId: resolvedUserId,
        userName: resolvedUserName,
        text: "",
        isFinal: false,
        speechSupported: false,
        updatedAt: now,
      },
      SPEAKING_INDICATOR_DURATION
    );

    // Throttle network publishes — only send once every 8 seconds
    if (now - lastUntranscribablePublishRef.current < UNTRANSCRIBABLE_PUBLISH_INTERVAL) return;

    if (!consume()) return;

    lastUntranscribablePublishRef.current = now;

    const event: CaptionEvent = {
      type: "caption",
      userId: resolvedUserId,
      userName: resolvedUserName,
      text: "",
      isFinal: false,
      speechSupported: false,
      timestamp: now,
    };

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(event));

    void currentRoom.localParticipant
      .publishData(data, {
        reliable: false,
        topic: LIVEKIT_TOPICS.CAPTIONS,
      })
      .catch((err) => {
        if (isExpectedClosedPublishError(err)) return;
        logError("[LiveKitCaptions] publishData failed:", err);
      });
  }, [consume, upsertCaption]);

  // Keep lastLocalDominantSpeakerAtRef up to date via LiveKit's active speaker events.
  // More accurate than checking lp.isSpeaking at send time because the event
  // fires as soon as the echo-cancelled audio level crosses the threshold.
  useEffect(() => {
    if (!room) return;
    const handleActiveSpeakers = (speakers: Participant[]) => {
      if (speakers.some((s) => s.isLocal)) {
        lastLocalDominantSpeakerAtRef.current = Date.now();
      }
    };
    room.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
    };
  }, [room]);

  // Add a local mic-level proof when the published mic track is available.
  // This does not stop or replace the LiveKit track; it only reads a copy.
  useEffect(() => {
    if (!room || typeof AudioContext === "undefined") return;

    let cancelled = false;
    let raf = 0;
    let audioContext: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;

    const startAnalyser = async () => {
      const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const mediaStreamTrack = publication?.audioTrack?.mediaStreamTrack;
      if (!mediaStreamTrack) return;

      audioContext = new AudioContext();
      await audioContext.resume().catch(() => undefined);
      if (cancelled || !audioContext) return;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source = audioContext.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
      source.connect(analyser);
      micProofAvailableRef.current = true;

      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (cancelled) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          sum += samples[i] * samples[i];
        }
        const rms = Math.sqrt(sum / samples.length);
        if (rms > 0.018) {
          lastMicSpeechAtRef.current = Date.now();
        }
        raf = window.setTimeout(tick, 80) as unknown as number;
      };
      tick();
    };

    void startAnalyser().catch((err) => {
      micProofAvailableRef.current = false;
      logError("[LiveKitCaptions] local mic analyser failed:", err);
    });

    return () => {
      cancelled = true;
      micProofAvailableRef.current = false;
      if (raf) window.clearTimeout(raf);
      source?.disconnect();
      void audioContext?.close().catch(() => undefined);
    };
  }, [room]);

  // Ref to avoid stale closure in data handler
  const upsertCaptionRef = useRef(upsertCaption);
  upsertCaptionRef.current = upsertCaption;

  const receiverLimiterRef = useRef(new ReceiverRateLimiter(15));

  // Listen for incoming captions
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (
      payload: Uint8Array,
      participant?: { identity?: string; name?: string },
      _kind?: unknown,
      topic?: string
    ) => {
      if (topic !== LIVEKIT_TOPICS.CAPTIONS) return;

      // Skip our own captions (we display them locally)
      const localId = room.localParticipant?.identity;
      const senderId = participant?.identity ?? "unknown";
      if (senderId === localId) return;

      // Receiver-side rate limit
      if (!receiverLimiterRef.current.shouldAllow(senderId)) return;

      try {
        const decoder = new TextDecoder();
        const messageStr = decoder.decode(payload);
        const data = JSON.parse(messageStr) as CaptionEvent;

        if (data.type !== "caption") return;

        // Resolve identity/name from the signed LiveKit participant object.
        const trustedUserId = participant?.identity ?? senderId;
        const resolvedName =
          participant && "name" in participant && participant.name
            ? (participant.name as string)
            : participant?.identity ?? data.userName;

        const line: CaptionLine = {
          userId: trustedUserId,
          userName: resolvedName,
          text: data.text?.slice(0, MESSAGE_LIMITS.MAX_CAPTION_LENGTH) ?? "",
          isFinal: data.isFinal,
          speechSupported: data.speechSupported,
          updatedAt: Date.now(),
          segmentId: data.segmentId,
          language: data.language,
        };

        const duration = data.speechSupported
          ? data.isFinal
            ? CAPTION_DISPLAY_DURATION
            : CAPTION_DISPLAY_DURATION * 2
          : SPEAKING_INDICATOR_DURATION;

        upsertCaptionRef.current(line, duration);
        if (data.isFinal && line.text) {
          appendHistory({
            ...line,
            segmentId: data.segmentId ?? `remote:${trustedUserId}:${data.timestamp}`,
            startedAt: data.startedAt ?? data.timestamp,
          });
          // Forward to transcript buffer so remote speech is persisted
          onRemoteCaptionRef.current?.(trustedUserId, resolvedName, line.text, {
            startedAt: data.startedAt ?? data.timestamp,
            language: data.language,
            segmentId: data.segmentId ?? `remote:${trustedUserId}:${data.timestamp}`,
          });
        }
      } catch (error) {
        logError("[LiveKitCaptions] Failed to parse caption:", error);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [appendHistory, room]);

  // Clear timers when room disconnects
  useEffect(() => {
    if (room) return;
    for (const timer of expiryTimersRef.current.values()) {
      clearTimeout(timer);
    }
    expiryTimersRef.current.clear();
    setCaptions([]);
    setCaptionHistory([]);
  }, [room]);

  // Cleanup expiry timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of expiryTimersRef.current.values()) {
        clearTimeout(timer);
      }
      expiryTimersRef.current.clear();
    };
  }, []);

  return {
    captions,
    captionHistory,
    sendCaption,
    sendUntranscribable,
  };
}
