export type CaptionCaptureState =
  | "idle"
  | "unsupported"
  | "permission-denied"
  | "mic-muted"
  | "starting"
  | "listening"
  | "language-unsupported"
  | "network-error"
  | "audio-error";

export const captionCaptureCopy: Record<CaptionCaptureState, { label: string; description: string }> = {
  idle: {
    label: "Captions off",
    description: "Turn on captions to see live transcription of the meeting.",
  },
  unsupported: {
    label: "Captions unavailable",
    description: "This browser doesn't support live captions. Try Chrome, Edge, or Safari.",
  },
  "permission-denied": {
    label: "Speech permission blocked",
    description: "Allow microphone or speech-recognition access in your browser to caption your speech.",
  },
  "mic-muted": {
    label: "Mic muted",
    description: "Unmute your microphone to caption your own speech.",
  },
  starting: {
    label: "Starting captions",
    description: "Waiting for the browser speech recognizer to start.",
  },
  listening: {
    label: "Capturing your speech",
    description: "Your microphone is being transcribed live.",
  },
  "language-unsupported": {
    label: "Language not supported",
    description: "This browser can't transcribe the selected spoken language. Pick a different one.",
  },
  "network-error": {
    label: "Speech service offline",
    description: "Your browser can't reach the speech recognition service. Reconnect, then re-enable captions.",
  },
  "audio-error": {
    label: "Microphone unavailable",
    description: "The browser couldn't capture audio for transcription. Check your mic and try again.",
  },
};

export function captionCaptureTone(state: CaptionCaptureState) {
  if (state === "listening") return "bg-emerald-400";
  if (state === "starting") return "bg-amber-400";
  if (state === "idle") return "bg-neutral-400";
  return "bg-red-400";
}
