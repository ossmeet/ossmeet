import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSpeechRecognitionConstructor,
  type SpeechRecognitionEvent,
  type SpeechRecognitionInstance,
} from "./speech-recognition-support";

export interface SpeechTranscriptMeta {
  segmentId: string;
  language: string;
  startedAt: number;
}

export interface SpeechRecognitionTranscriptResult {
  text: string;
  isFinal: boolean;
}

export interface UseSpeechRecognitionOptions {
  lang?: string;
  onTranscript?: (text: string, isFinal: boolean, meta: SpeechTranscriptMeta) => void;
}

export function extractSpeechRecognitionResults(
  event: SpeechRecognitionEvent,
): SpeechRecognitionTranscriptResult[] {
  const results: SpeechRecognitionTranscriptResult[] = [];
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    const text = result?.[0]?.transcript?.trim() ?? "";
    if (!text) continue;
    results.push({ text, isFinal: Boolean(result.isFinal) });
  }
  return results;
}

/** Errors that mean the user (or OS) blocked us. Don't auto-restart. */
const PERMANENT_ERRORS = new Set(["not-allowed", "service-not-allowed"]);

/** Errors that are transient (silence timeout, network blip, busy mic). */
const TRANSIENT_ERRORS = new Set([
  "no-speech",
  "aborted",
  "network",
  "audio-capture",
  "bad-grammar",
  "language-not-supported",
]);

/**
 * Max consecutive transient errors before we give up and surface a state
 * the UI can show. Reset to zero whenever the recognizer successfully
 * delivers a result or is started fresh by the user.
 */
const MAX_TRANSIENT_RESTARTS = 5;
const RESTART_DELAY_MS = 350;

/**
 * Thin wrapper over the Web Speech API.
 *
 * Lifecycle: callers decide when to start/stop. While active, if the browser
 * ends the recognizer on its own we restart it after a short delay, capping
 * how many consecutive transient failures we tolerate before surfacing an
 * error and standing down. Hard errors (permission denial,
 * `language-not-supported`) stop us immediately.
 *
 * Fires `onTranscript` for each changed result in the Web Speech event. Final
 * segments get a stable `segmentId` so callers can deduplicate when persisting.
 */
export type SpeechRecognitionRecoverableError =
  | "network"
  | "audio-capture"
  | "language-not-supported"
  | "unknown";

export function useSpeechRecognition({ lang = "en-US", onTranscript }: UseSpeechRecognitionOptions = {}) {
  const isSupported = getSpeechRecognitionConstructor() !== null;
  const [isListening, setIsListening] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [recoverableError, setRecoverableError] =
    useState<SpeechRecognitionRecoverableError | null>(null);

  const wantActiveRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartAttemptsRef = useRef(0);
  const segmentCounterRef = useRef(0);
  const sessionIdRef = useRef("");
  const segmentStartedAtRef = useRef<number | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const teardown = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const rec = recognitionRef.current;
    if (rec) {
      rec.onstart = null;
      rec.onend = null;
      rec.onerror = null;
      rec.onresult = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
  }, []);

  const startInternal = useCallback(() => {
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) return;

    teardown();
    if (!wantActiveRef.current) return;

    const language = langRef.current;
    const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionIdRef.current = sessionId;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = language;

    rec.onstart = () => {
      if (sessionIdRef.current === sessionId) setIsListening(true);
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      if (sessionIdRef.current !== sessionId) return;
      // Any successful result means the recognizer is healthy — reset the
      // restart counter so a later transient error gets a full retry budget.
      restartAttemptsRef.current = 0;
      for (const result of extractSpeechRecognitionResults(event)) {
        const now = Date.now();
        const startedAt = segmentStartedAtRef.current ?? now;
        segmentStartedAtRef.current = result.isFinal ? null : startedAt;
        const meta: SpeechTranscriptMeta = {
          segmentId: result.isFinal
            ? `ws:${sessionId}:${segmentCounterRef.current++}`
            : `ws:${sessionId}:interim`,
          language,
          startedAt,
        };
        onTranscriptRef.current?.(result.text, result.isFinal, meta);
      }
    };

    rec.onerror = (event) => {
      if (sessionIdRef.current !== sessionId) return;
      const code = event.error;

      if (PERMANENT_ERRORS.has(code)) {
        wantActiveRef.current = false;
        setPermissionDenied(true);
        setIsListening(false);
        return;
      }

      if (code === "language-not-supported") {
        // The selected lang tag is not understood by this browser. Give up
        // entirely so the user picks a different language; restarting would
        // just hit the same error.
        wantActiveRef.current = false;
        setIsListening(false);
        setRecoverableError("language-not-supported");
        return;
      }

      // For other transient errors, account toward the restart budget. The
      // actual restart is scheduled in onend (which always fires after onerror).
      if (!TRANSIENT_ERRORS.has(code)) {
        // Unknown error: log for visibility but treat as transient.
        setRecoverableError("unknown");
      } else if (code === "network" || code === "audio-capture") {
        setRecoverableError(code);
      }
    };

    rec.onend = () => {
      if (sessionIdRef.current !== sessionId) return;
      setIsListening(false);
      if (!wantActiveRef.current) return;

      restartAttemptsRef.current += 1;
      if (restartAttemptsRef.current > MAX_TRANSIENT_RESTARTS) {
        // Stop bouncing — leave the recognizer off until the user re-toggles
        // or the language changes. The error state stays visible.
        wantActiveRef.current = false;
        sessionIdRef.current = "";
        if (restartTimerRef.current) {
          clearTimeout(restartTimerRef.current);
          restartTimerRef.current = null;
        }
        return;
      }

      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (wantActiveRef.current) startInternal();
      }, RESTART_DELAY_MS);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      // start() throws if invoked while a previous session is still tearing
      // down. The onend → restart path will recover automatically.
    }
  }, [teardown]);

  const start = useCallback(() => {
    if (!getSpeechRecognitionConstructor()) return;
    setPermissionDenied(false);
    setRecoverableError(null);
    restartAttemptsRef.current = 0;
    wantActiveRef.current = true;
    startInternal();
  }, [startInternal]);

  const stop = useCallback(() => {
    wantActiveRef.current = false;
    sessionIdRef.current = "";
    segmentStartedAtRef.current = null;
    restartAttemptsRef.current = 0;
    teardown();
    setIsListening(false);
  }, [teardown]);

  const toggle = useCallback(() => {
    if (wantActiveRef.current) stop();
    else start();
  }, [start, stop]);

  // Restart on language change while active. Clear any previous
  // language-not-supported state so the new tag gets a fair attempt.
  useEffect(() => {
    if (!wantActiveRef.current) return;
    setRecoverableError((prev) => (prev === "language-not-supported" ? null : prev));
    restartAttemptsRef.current = 0;
    startInternal();
  }, [lang, startInternal]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      wantActiveRef.current = false;
      sessionIdRef.current = "";
      segmentStartedAtRef.current = null;
      teardown();
    };
  }, [teardown]);

  return {
    isSupported,
    isListening,
    permissionDenied,
    recoverableError,
    start,
    stop,
    toggle,
  };
}
