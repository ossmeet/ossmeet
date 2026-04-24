import { useState, useCallback, useRef, useEffect } from "react";
import {
  getSpeechRecognitionConstructor,
  type SpeechRecognitionEvent,
  type SpeechRecognitionInstance,
} from "./speech-recognition-support";

export interface SpeechTranscriptMeta {
  segmentId: string;
  language: string;
  startedAt: number;
  updatedAt: number;
}

// Minimum confidence to accept a final result. Browsers report 0 when they
// don't implement confidence scoring — treat that as "unknown, allow through".
// Echo/loopback transcriptions tend to score low when confidence is reported.
const MIN_CONFIDENCE = 0.5;

export interface UseSpeechRecognitionOptions {
  lang?: string;
  onTranscript?: (text: string, isFinal: boolean, meta: SpeechTranscriptMeta) => void;
}

/**
 * Hook wrapping the Web Speech API for real-time speech-to-text.
 * Returns isSupported=false on browsers without the API (Firefox, etc).
 *
 * Uses a generation counter so that when the language changes,
 * the old instance's onend handler knows it's stale and won't restart.
 */
export function useSpeechRecognition({
  lang = "en-US",
  onTranscript,
}: UseSpeechRecognitionOptions = {}) {
  const isSupported = getSpeechRecognitionConstructor() !== null;
  const [isListening, setIsListening] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  // Generation counter: each start() increments this. The onend handler
  // only restarts if its generation still matches the current one.
  const generationRef = useRef(0);
  const wantActiveRef = useRef(false);
  const segmentIndexRef = useRef(0);
  // Ref so onend can call startInternal without stale closure
  const startInternalRef = useRef<((language: string) => void) | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  const stopInternal = useCallback(() => {
    wantActiveRef.current = false;
    generationRef.current++;
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startInternal = useCallback(
    (language: string) => {
      const Ctor = getSpeechRecognitionConstructor();
      if (!Ctor) return;

      // Kill any existing instance
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }

      const gen = ++generationRef.current;
      const instanceId = `${Date.now().toString(36)}-${segmentIndexRef.current++}`;
      wantActiveRef.current = true;

      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;

      recognition.onstart = () => {
        if (generationRef.current === gen) {
          setIsListening(true);
        }
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (generationRef.current !== gen) return;

        let interimTranscript = "";
        let finalTranscript = "";
        let firstStartedAt = Number.POSITIVE_INFINITY;
        let latestUpdatedAt = 0;

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const alt = result[0];
          const segmentTime = Date.now();
          firstStartedAt = Math.min(firstStartedAt, segmentTime);
          latestUpdatedAt = Math.max(latestUpdatedAt, segmentTime);
          if (result.isFinal) {
            // Skip low-confidence finals. confidence === 0 means unsupported
            // by this browser, so we allow those through.
            if (alt.confidence > 0 && alt.confidence < MIN_CONFIDENCE) continue;
            finalTranscript += alt.transcript;
          } else {
            interimTranscript += alt.transcript;
          }
        }

        const now = Date.now();
        const meta: SpeechTranscriptMeta = {
          segmentId: `webspeech:${language}:${instanceId}:${event.resultIndex}`,
          language,
          startedAt: Number.isFinite(firstStartedAt) ? firstStartedAt : now,
          updatedAt: latestUpdatedAt || now,
        };

        if (finalTranscript) {
          onTranscriptRef.current?.(finalTranscript, true, meta);
        } else if (interimTranscript) {
          onTranscriptRef.current?.(interimTranscript, false, meta);
        }
      };

      recognition.onerror = (event) => {
        if (generationRef.current !== gen) return;
        if (event.error === "aborted" || event.error === "no-speech") return;
        if (event.error === "not-allowed") {
          wantActiveRef.current = false;
          setPermissionDenied(true);
          setIsListening(false);
          return;
        }
        // Fallback bn-BD → bn-IN (some browsers only ship bn-IN)
        if (language === "bn-BD") {
          startInternalRef.current?.("bn-IN");
        }
      };

      recognition.onend = () => {
        // Only restart if this is still the current generation
        // and we still want to be active
        if (generationRef.current !== gen || !wantActiveRef.current) {
          if (generationRef.current === gen) {
            setIsListening(false);
          }
          return;
        }
        // Web Speech API can stop on its own (silence timeout).
        // Create a fresh instance for restart — some browsers (Safari)
        // require a new SpeechRecognition object after onend fires.
        startInternalRef.current?.(langRef.current);
      };

      recognitionRef.current = recognition;

      try {
        recognition.start();
      } catch {
        // May fail if browser is still cleaning up — retry after a short delay
        setTimeout(() => {
          if (generationRef.current !== gen || !wantActiveRef.current) return;
          try {
            recognition.start();
          } catch {
            setIsListening(false);
          }
        }, 200);
      }
    },
    []
  );
  startInternalRef.current = startInternal;

  const start = useCallback(() => {
    setPermissionDenied(false);
    startInternal(langRef.current);
  }, [startInternal]);

  const stop = useCallback(() => {
    stopInternal();
  }, [stopInternal]);

  // When lang changes while listening, restart with new language
  useEffect(() => {
    if (wantActiveRef.current) {
      startInternal(lang);
    }
  }, [lang, startInternal]);

  const toggle = useCallback(() => {
    if (wantActiveRef.current) {
      stop();
    } else {
      start();
    }
  }, [start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wantActiveRef.current = false;
      generationRef.current++;
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  return { isSupported, isListening, permissionDenied, start, stop, toggle };
}
