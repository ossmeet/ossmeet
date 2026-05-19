import * as React from "react";
import type { Room } from "livekit-client";
import { useLiveKitCaptions, useTranscriptBuffer } from "@/lib/meeting";
import { useSpeechRecognition, type SpeechTranscriptMeta } from "./use-speech-recognition";
import { saveSpokenLanguage, speechLanguageDisplayName, SPEECH_LANGUAGE_OPTIONS } from "./speech-languages";
import { getClientMeetingHints } from "@/server/client-hints";
import { useSpeechStartupReady } from "./speech-startup";
import type { CaptionCaptureState } from "./caption-state";

export function useMeetingCaptions({
  roomInstance,
  meetingId,
  admissionId,
  connectionId,
  participantIdentity,
  participantName,
  initialCaptionLanguage,
  isMicOn,
  showConnectingOverlay,
}: {
  roomInstance: Room | undefined;
  meetingId: string;
  admissionId: string;
  connectionId: string;
  participantIdentity: string;
  participantName: string;
  initialCaptionLanguage: string;
  isMicOn: boolean;
  showConnectingOverlay: boolean;
}) {
  const [showCaptions, setShowCaptions] = React.useState(false);
  const [showCaptionLanguagePicker, setShowCaptionLanguagePicker] = React.useState(false);
  const [captionCountry, setCaptionCountry] = React.useState<string | null>(null);
  const [captionLanguage, setCaptionLanguage] = React.useState(initialCaptionLanguage);

  const {
    addSegment,
    flush: flushTranscripts,
    pendingCount: transcriptPendingCount,
    isFlushing: transcriptFlushing,
    lastFlushFailed: transcriptFlushFailed,
  } = useTranscriptBuffer({
    meetingId,
    admissionId,
    connectionId,
    participantIdentity,
    participantName,
  });

  const { captions, sendCaption } = useLiveKitCaptions(roomInstance);

  const {
    isSupported: speechSupported,
    isListening: speechListening,
    permissionDenied: speechPermissionDenied,
    recoverableError: speechRecoverableError,
    start: startSpeech,
    stop: stopSpeech,
  } = useSpeechRecognition({
    lang: captionLanguage,
    onTranscript: React.useCallback(
      (text: string, isFinal: boolean, meta: SpeechTranscriptMeta) => {
        sendCaption(text, isFinal, meta);
        if (isFinal) addSegment(text, meta);
      },
      [sendCaption, addSegment],
    ),
  });

  const handleToggleCaptions = React.useCallback(() => {
    setShowCaptions((prev) => {
      if (prev) void flushTranscripts().catch(() => {});
      return !prev;
    });
  }, [flushTranscripts]);

  React.useEffect(() => {
    saveSpokenLanguage(captionLanguage);
  }, [captionLanguage]);

  React.useEffect(() => {
    let cancelled = false;
    getClientMeetingHints()
      .then((hints) => {
        if (!cancelled) setCaptionCountry(hints.country);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const captionLanguageLabel = React.useMemo(() => {
    const option = SPEECH_LANGUAGE_OPTIONS.find((entry) => entry.tag === captionLanguage);
    return option ? speechLanguageDisplayName(option) : captionLanguage;
  }, [captionLanguage]);

  const autoTranscriptionEnabled = speechSupported;
  const speechStartupReady = useSpeechStartupReady(
    roomInstance,
    isMicOn,
    !showConnectingOverlay,
  );

  React.useEffect(() => {
    if (!speechSupported) return;
    if (speechStartupReady) startSpeech();
    else stopSpeech();
  }, [speechStartupReady, speechSupported, startSpeech, stopSpeech]);

  const captionCaptureState = React.useMemo<CaptionCaptureState>(() => {
    if (!showCaptions) return "idle";
    if (!speechSupported) return "unsupported";
    if (speechPermissionDenied) return "permission-denied";
    if (speechRecoverableError === "language-not-supported") return "language-unsupported";
    if (speechRecoverableError === "network") return "network-error";
    if (speechRecoverableError === "audio-capture") return "audio-error";
    if (!isMicOn) return "mic-muted";
    if (speechListening) return "listening";
    return "starting";
  }, [
    isMicOn,
    showCaptions,
    speechListening,
    speechPermissionDenied,
    speechRecoverableError,
    speechSupported,
  ]);

  return {
    showCaptions,
    showCaptionLanguagePicker,
    setShowCaptionLanguagePicker,
    captionLanguage,
    setCaptionLanguage,
    captionLanguageLabel,
    captionCountry,
    captions,
    speechSupported,
    speechListening,
    speechPermissionDenied,
    captionCaptureState,
    transcriptPendingCount,
    transcriptFlushing,
    transcriptFlushFailed,
    autoTranscriptionEnabled,
    handleToggleCaptions,
    flushTranscripts,
  };
}
