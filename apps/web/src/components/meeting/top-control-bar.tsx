import { useState, useCallback, useRef, useEffect } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  SquarePen,
  MessageCircle,
  Users,
  PhoneOff,
  Hand,
  Copy,
  Check,
  Captions,
  CaptionsOff,
  Search,
  X,
  AudioWaveform,
  Timer,
  RefreshCw,
  Radio,
} from "lucide-react";
import { cn } from "@ossmeet/shared";
import { BackgroundEffectButton } from "@/components/meeting/background-effect-picker";
import { CaptionLanguagePicker } from "@/components/meeting/caption-language-picker";
import { PopoverRoot, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import type { StreamingPlatform } from "@ossmeet/shared";
import {
  STREAMING_DESTINATIONS,
  readStreamingPreference,
  writeStreamingPreference,
} from "@/lib/meeting/streaming-preferences";
import {
  captionCaptureCopy,
  captionCaptureTone,
  type CaptionCaptureState,
} from "@/lib/meeting/caption-state";
import type { BackgroundMode } from "@/lib/meeting/use-background-effect";

/** White circle outline with a red center dot — used as the "start recording" icon. */
function RecordDotIcon({ className, strokeWidth = 2, ...props }: React.SVGProps<SVGSVGElement> & { strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} {...props}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth={strokeWidth} />
      <circle cx="12" cy="12" r="3" fill="#f87171" stroke="none" />
    </svg>
  );
}

function StopRecordIcon({ className, strokeWidth = 2, ...props }: React.SVGProps<SVGSVGElement> & { strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} {...props}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth={strokeWidth} />
      <rect x="8.5" y="8.5" width="7" height="7" rx="0.5" fill="#f87171" stroke="none" className="animate-pulse" />
    </svg>
  );
}

interface TopControlBarProps {
  code: string;
  meetingStartTime: number;
  participantCount: number;
  connectionQuality?: "excellent" | "good" | "poor" | "disconnected";
  isMicOn: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isRecording: boolean;
  recordingPending?: boolean;
  showWhiteboard?: boolean;
  showChat: boolean;
  showParticipants: boolean;
  unreadCount: number;
  isHandRaised?: boolean;
  showCaptions?: boolean;
  captionCaptureState?: CaptionCaptureState;
  transcriptPendingCount?: number;
  transcriptFlushing?: boolean;
  transcriptFlushFailed?: boolean;
  captionLanguageTag?: string;
  captionLanguageLabel?: string;
  captionCountry?: string | null;
  onSelectCaptionLanguage?: (lang: string) => void;
  whiteboardDisabled?: boolean;
  whiteboardDisabledReason?: string | null;
  showRecordingControl?: boolean;
  recordingDisabled?: boolean;
  isStreaming?: boolean;
  streamingPending?: boolean;
  showStreamingControl?: boolean;
  onGoLive?: (platform: StreamingPlatform, streamKey: string) => Promise<void>;
  onStopStream?: () => Promise<void>;
  isNoiseFilterEnabled?: boolean;
  isNoiseFilterPending?: boolean;
  showNoiseFilterControl?: boolean;
  noiseFilterDisabled?: boolean;
  noiseFilterUnavailableReason?: string | null;
  onToggleNoiseFilter?: () => void;
  backgroundMode?: BackgroundMode;
  backgroundImagePath?: string | null;
  backgroundSupported?: boolean;
  backgroundProcessing?: boolean;
  onBackgroundNone?: () => void;
  onBackgroundBlur?: () => void;
  onBackgroundImage?: (path: string) => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleRecording: () => void;
  onToggleWhiteboard?: () => void;
  onSyncWhiteboard?: () => void;
  isSyncingWhiteboard?: boolean;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onSearch?: (query: string) => void;
  onToggleHandRaise?: () => void;
  onToggleCaptions?: () => void;
  onLeave: () => void;
}

const connectionDotColor = {
  excellent: "bg-emerald-400",
  good: "bg-emerald-400",
  poor: "bg-amber-400",
  disconnected: "bg-red-400",
} as const;

function formatDuration(seconds: number) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// ── Divider ───────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="mx-1 h-4 w-px bg-neutral-300/70 shrink-0" />;
}

// ── Bar button ────────────────────────────────────────────────────────────────

interface BarButtonProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  danger?: boolean;
  pulse?: boolean;
  badge?: number;
  disabled?: boolean;
  tooltip?: string;
  className?: string;
  onClick: () => void;
}

function BarButton({
  icon: Icon,
  label,
  active = false,
  danger = false,
  pulse = false,
  badge,
  disabled = false,
  tooltip,
  className,
  onClick,
}: BarButtonProps) {
  return (
    <Tooltip content={tooltip ?? label} side="bottom">
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30",
          disabled && "cursor-not-allowed opacity-40",
          danger
            ? "bg-red-500 text-white hover:bg-red-600 shadow-sm"
            : active
              ? "bg-accent-600 text-white shadow-sm"
              : "text-neutral-600 hover:bg-neutral-300/70 hover:text-neutral-900",
          className,
        )}
        aria-label={tooltip ?? label}
        title={tooltip ?? label}
      >
        {pulse && (
          <span className="absolute inset-1 rounded-lg bg-current/15 animate-pulse" aria-hidden="true" />
        )}
        <Icon className="h-4 w-4" strokeWidth={active ? 2.5 : 1.75} />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-accent-500 px-0.5 text-3xs font-bold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

// ── Caption button ────────────────────────────────────────────────────────────

function CaptionButton({
  showCaptions,
  captionCaptureState = "idle",
  transcriptPendingCount = 0,
  transcriptFlushing = false,
  transcriptFlushFailed = false,
  onToggleCaptions,
  captionLanguageTag,
  captionLanguageLabel,
  captionCountry,
  onSelectCaptionLanguage,
}: {
  showCaptions: boolean;
  captionCaptureState?: CaptionCaptureState;
  transcriptPendingCount?: number;
  transcriptFlushing?: boolean;
  transcriptFlushFailed?: boolean;
  onToggleCaptions: () => void;
  captionLanguageTag?: string;
  captionLanguageLabel?: string;
  captionCountry?: string | null;
  onSelectCaptionLanguage?: (lang: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const statusCopy = captionCaptureCopy[captionCaptureState];
  const isUnsupported = captionCaptureState === "unsupported";
  const tooltip = isUnsupported
    ? "Captions unavailable in this browser"
    : showCaptions
      ? `Captions on · ${captionLanguageLabel ?? captionLanguageTag ?? "Default"}`
      : "Caption & language settings";

  const buttonClassName = cn(
    "relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150",
    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30",
    showCaptions
      ? "bg-accent-600 text-white shadow-sm"
      : "text-neutral-600 hover:bg-neutral-300/70 hover:text-neutral-900",
    isUnsupported && "cursor-not-allowed opacity-60",
  );

  const triggerButton = (
    <button
      type="button"
      aria-label={tooltip}
      aria-pressed={showCaptions}
      title={tooltip}
      disabled={isUnsupported}
      className={buttonClassName}
    >
      {showCaptions ? (
        <Captions className="h-4 w-4" strokeWidth={2.5} />
      ) : (
        <CaptionsOff className="h-4 w-4" strokeWidth={1.75} />
      )}
      {showCaptions && (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-neutral-200",
            captionCaptureTone(captionCaptureState),
          )}
          aria-hidden="true"
        />
      )}
    </button>
  );

  if (isUnsupported || !onSelectCaptionLanguage) {
    return (
      <div className="relative">
        <Tooltip content={tooltip} side="bottom">
          {triggerButton}
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="relative">
      <PopoverRoot open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={triggerButton} />
        <PopoverContent
          side="bottom"
          align="end"
          className="w-80 rounded-2xl border border-stone-200 bg-white p-3 text-stone-900 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.3)]"
        >
          {/* Captions display toggle */}
          <button
            type="button"
            onClick={() => { onToggleCaptions(); setOpen(false); }}
            className={cn(
              "mb-2 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
              showCaptions
                ? "bg-accent-50 text-accent-800 hover:bg-accent-100"
                : "bg-stone-50 text-stone-800 hover:bg-stone-100",
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              {showCaptions ? <Captions className="h-4 w-4" /> : <CaptionsOff className="h-4 w-4" />}
              {showCaptions ? "Captions on" : "Show live captions"}
            </span>
            <span className="text-xs text-stone-500">
              {showCaptions ? "Tap to hide" : "Tap to show"}
            </span>
          </button>

          {/* Status pill */}
          <div className="mb-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-stone-800">
              <span className={cn("h-2 w-2 rounded-full", captionCaptureTone(captionCaptureState))} />
              {statusCopy.label}
            </div>
            <p className="mt-1 text-xs leading-5 text-stone-500">{statusCopy.description}</p>
            {(transcriptPendingCount > 0 || transcriptFlushing || transcriptFlushFailed) && (
              <p className="mt-1 text-xs leading-5 text-stone-500">
                {transcriptFlushFailed
                  ? "Saving transcript failed; will retry while this tab is open."
                  : transcriptFlushing
                    ? "Saving transcript…"
                    : `${transcriptPendingCount} transcript segment${transcriptPendingCount === 1 ? "" : "s"} waiting to save.`}
              </p>
            )}
          </div>

          {/* Language picker */}
          <div className="mb-2 text-sm font-medium text-stone-900">My spoken language</div>
          <p className="mb-2 text-xs leading-5 text-stone-500">
            Your browser uses this to transcribe your own microphone. Other people see captions in the language you publish.
          </p>
          <CaptionLanguagePicker
            country={captionCountry}
            selectedLanguage={captionLanguageTag ?? "en-US"}
            onSelectLanguage={(lang) => { onSelectCaptionLanguage(lang); setOpen(false); }}
            autoFocusSearch
            variant="light"
          />
        </PopoverContent>
      </PopoverRoot>
    </div>
  );
}

// ── Countdown timer ───────────────────────────────────────────────────────────

async function playCountdownCompletionSound() {
  if (typeof window === "undefined") return;
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const startAt = context.currentTime + 0.02;
  const tones = [
    { frequency: 880, offset: 0, duration: 0.12 },
    { frequency: 1046.5, offset: 0.16, duration: 0.12 },
    { frequency: 1318.5, offset: 0.34, duration: 0.22 },
  ];
  tones.forEach(({ frequency, offset, duration }) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt + offset);
    gain.gain.setValueAtTime(0.0001, startAt + offset);
    gain.gain.exponentialRampToValueAtTime(0.08, startAt + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt + offset);
    oscillator.stop(startAt + offset + duration);
  });
  window.setTimeout(() => { void context.close().catch(() => {}); }, 1200);
}

// ── Platform icons (inline SVG) ───────────────────────────────────────────────

const PLATFORM_META: Record<StreamingPlatform, { label: string; color: string; icon: React.ReactNode }> = {
  twitch: {
    label: "Twitch",
    color: "#9146FF",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
      </svg>
    ),
  },
  youtube: {
    label: "YouTube",
    color: "#FF0000",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z" />
      </svg>
    ),
  },
  facebook: {
    label: "Facebook",
    color: "#1877F2",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
  },
  kick: {
    label: "Kick",
    color: "#53fc18",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M4 4h5v6.2L14.6 4H21l-7.2 7.6L21.5 20h-6.7L9 13.3V20H4z" />
      </svg>
    ),
  },
  linkedin: {
    label: "LinkedIn",
    color: "#0A66C2",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M5.4 8.7h3.5V20H5.4zM7.2 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4m4.1 4.7h3.4v1.5h.1c.5-.9 1.7-1.8 3.5-1.8 3.7 0 4.4 2.4 4.4 5.6v6h-3.5v-5.3c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8V20h-3.5V8.7z" />
      </svg>
    ),
  },
  instagram: {
    label: "Instagram",
    color: "#E1306C",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
        <rect x="4.5" y="4.5" width="15" height="15" rx="4.5" stroke="currentColor" strokeWidth="2.1" />
        <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="2.1" />
        <circle cx="16.8" cy="7.2" r="1.1" fill="currentColor" />
      </svg>
    ),
  },
  tiktok: {
    label: "TikTok",
    color: "#111827",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M14.6 3h3.1c.2 1.4 1 2.6 2.1 3.5.7.5 1.4.9 2.2 1v3.3a7.8 7.8 0 0 1-4.2-1.3v5.9c0 3.2-2.6 5.8-5.9 5.8A5.7 5.7 0 0 1 6 15.6c0-3.5 3-6.1 6.4-5.7v3.4a2.5 2.5 0 0 0-3 2.4 2.5 2.5 0 0 0 2.5 2.5 2.4 2.4 0 0 0 2.5-2.5V3z" />
      </svg>
    ),
  },
  x: {
    label: "X",
    color: "#18181b",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M4.2 4h4.9l3.6 5.1L17.2 4h2.7l-6 6.9L20.2 20h-4.9l-4-5.7L6.3 20H3.6l6.5-7.5zM7 5.6l9.1 12.8h1.3L8.3 5.6z" />
      </svg>
    ),
  },
  custom: {
    label: "Custom",
    color: "#57534e",
    icon: <Radio className="h-4 w-4" strokeWidth={1.75} />,
  },
};

type StreamingPlatformId = StreamingPlatform;

function GoLiveButton({
  isStreaming,
  streamingPending,
  onGoLive,
  onStopStream,
  disabled,
}: {
  isStreaming: boolean;
  streamingPending: boolean;
  onGoLive?: (platform: StreamingPlatform, streamKey: string) => Promise<void>;
  onStopStream?: () => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<StreamingPlatformId>("twitch");
  const [streamKey, setStreamKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectedDestination = STREAMING_DESTINATIONS.find((destination) => destination.id === selectedPlatform) ?? STREAMING_DESTINATIONS[0];

  useEffect(() => {
    const saved = readStreamingPreference();
    if (!saved) return;
    setSelectedPlatform(saved.platform);
    setStreamKey(saved.streamKey);
  }, []);

  const handleStart = async () => {
    if (!streamKey.trim() || !onGoLive) return;
    setSubmitting(true);
    try {
      const trimmedStreamKey = streamKey.trim();
      writeStreamingPreference({ platform: selectedPlatform, streamKey: trimmedStreamKey });
      await onGoLive(selectedPlatform, trimmedStreamKey);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStop = async () => {
    if (!onStopStream) return;
    setSubmitting(true);
    try {
      await onStopStream();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (isStreaming) {
    return (
      <PopoverRoot open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Streaming live — click to stop"
              className={cn(
                "relative flex h-8 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition-all duration-150",
                "bg-red-500 text-white shadow-sm hover:bg-red-600",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-red-500/30",
                streamingPending && "opacity-70 pointer-events-none",
              )}
            />
          }
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          LIVE
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="center"
          className="w-52 rounded-2xl bg-white p-3 shadow-2xl ring-1 ring-stone-200/80"
        >
          <p className="mb-2 text-xs font-semibold text-stone-800">Currently streaming live</p>
          <button
            type="button"
            onClick={handleStop}
            disabled={submitting}
            className="w-full rounded-xl bg-red-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
          >
            {submitting ? "Stopping…" : "Stop stream"}
          </button>
        </PopoverContent>
      </PopoverRoot>
    );
  }

  return (
    <PopoverRoot open={open} onOpenChange={(v) => { if (!disabled) setOpen(v); }}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Go live"
            disabled={disabled}
            className={cn(
              "relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30",
              disabled
                ? "cursor-not-allowed opacity-40 text-neutral-600"
                : "text-neutral-600 hover:bg-neutral-300/70 hover:text-neutral-900",
            )}
          />
        }
      >
        <Radio className="h-4 w-4" strokeWidth={1.75} />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="center"
        className="w-72 rounded-2xl bg-white p-3 shadow-2xl ring-1 ring-stone-200/80"
      >
        <p className="mb-3 text-xs font-semibold text-stone-800">Go live to</p>
        <div className="mb-3 grid grid-cols-4 gap-1.5">
          {STREAMING_DESTINATIONS.map((destination) => {
            const meta = PLATFORM_META[destination.id];
            return (
            <button
              key={destination.id}
              type="button"
              onClick={() => setSelectedPlatform(destination.id)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-xs font-medium transition-colors",
                selectedPlatform === destination.id
                  ? "ring-2 ring-offset-1 text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200",
              )}
              style={selectedPlatform === destination.id ? { backgroundColor: meta.color } : undefined}
            >
              {meta.icon}
              {meta.label}
            </button>
            );
          })}
        </div>
        <input
          type="text"
          aria-label={selectedDestination.keyLabel}
          placeholder={selectedDestination.placeholder}
          value={streamKey}
          onChange={(e) => setStreamKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleStart(); }}
          className="mb-2 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-800 placeholder-stone-400 outline-hidden focus:border-accent-400 focus:ring-1 focus:ring-accent-400/30"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={!streamKey.trim() || submitting}
          className="w-full rounded-xl bg-red-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? "Starting…" : "Go Live"}
        </button>
      </PopoverContent>
    </PopoverRoot>
  );
}

function CountdownTimerButton() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [customMinutes, setCustomMinutes] = useState("");
  const endTimeRef = useRef<number>(0);
  const completionSoundedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      const rem = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
      setRemaining(rem);
      if (rem === 0) {
        if (!completionSoundedRef.current) {
          completionSoundedRef.current = true;
          void playCountdownCompletionSound();
        }
        setActive(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [active]);

  const start = (minutes: number) => {
    if (minutes <= 0) return;
    endTimeRef.current = Date.now() + minutes * 60 * 1000;
    setRemaining(minutes * 60);
    setActive(true);
    setOpen(false);
    setCustomMinutes("");
    completionSoundedRef.current = false;
  };

  const stop = () => {
    setActive(false);
    setRemaining(0);
    setOpen(false);
    completionSoundedRef.current = true;
    endTimeRef.current = 0;
  };

  const isLow = active && remaining > 0 && remaining <= 30;
  const isDone = !active && remaining === 0 && endTimeRef.current > 0;

  const timerButton = (
    <button
      type="button"
      aria-label={active ? "Countdown timer" : "Set countdown timer"}
      title={active ? "Countdown" : isDone ? "Timer done" : "Countdown timer"}
      className={cn(
        "relative flex h-8 items-center justify-center gap-1 rounded-xl transition-all duration-150",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30",
        active || isDone ? "px-2" : "w-8",
        isLow
          ? "animate-pulse bg-red-500/20 text-red-500 hover:bg-red-500/25"
          : active
            ? "bg-amber-500/15 text-amber-600 hover:bg-amber-500/20"
            : isDone
              ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20"
              : "text-neutral-600 hover:bg-neutral-300/70 hover:text-neutral-900"
      )}
    >
      <Timer className="h-4 w-4 shrink-0" strokeWidth={active ? 2.5 : 1.75} />
      {active && <span className="font-mono text-xs font-medium">{formatDuration(remaining)}</span>}
      {isDone && <span className="text-xs font-medium">Done</span>}
    </button>
  );

  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={timerButton} />
      <PopoverContent
        side="bottom"
        align="start"
        className="w-52 rounded-2xl bg-warm-50/98 p-3 shadow-2xl ring-1 ring-warm-200/80 backdrop-blur-xl"
      >
        <p className="mb-2 text-xs font-medium text-warm-700">Countdown</p>
        <div className="mb-2 grid grid-cols-3 gap-1">
          {[5, 10, 15, 20, 25, 30].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => start(m)}
              className="rounded-xl bg-warm-100/80 px-2 py-1.5 text-xs text-warm-700 transition-colors hover:bg-warm-200/80"
            >
              {m}m
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            type="number"
            min="1"
            max="999"
            value={customMinutes}
            onChange={(e) => setCustomMinutes(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const m = parseInt(customMinutes, 10);
                if (!isNaN(m) && m > 0) start(m);
              }
            }}
            placeholder="Custom (min)"
            className="flex-1 rounded-xl border border-warm-200/80 bg-warm-50/80 px-2 py-1.5 text-xs text-warm-700 placeholder-warm-400 outline-hidden focus:border-accent-400 focus:ring-1 focus:ring-accent-400/30"
          />
          <button
            type="button"
            onClick={() => {
              const m = parseInt(customMinutes, 10);
              if (!isNaN(m) && m > 0) start(m);
            }}
            disabled={!customMinutes || parseInt(customMinutes, 10) <= 0}
            className="rounded-xl bg-warm-800/90 px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-warm-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start
          </button>
        </div>
        {active && (
          <button
            type="button"
            onClick={stop}
            className="mt-2 w-full rounded-xl px-3 py-2 text-left text-xs text-red-500 transition-colors hover:bg-red-50/80"
          >
            Stop countdown
          </button>
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}

// ── Top control bar ───────────────────────────────────────────────────────────

export function TopControlBar({
  code,
  meetingStartTime,
  participantCount,
  connectionQuality = "excellent",
  isMicOn,
  isCameraOn,
  isScreenSharing,
  isRecording,
  recordingPending = false,
  showWhiteboard = false,
  showChat,
  showParticipants,
  unreadCount,
  isHandRaised = false,
  showCaptions = false,
  captionCaptureState = "idle",
  transcriptPendingCount = 0,
  transcriptFlushing = false,
  transcriptFlushFailed = false,
  whiteboardDisabled = false,
  whiteboardDisabledReason = null,
  showRecordingControl = true,
  recordingDisabled = false,
  isStreaming = false,
  streamingPending = false,
  showStreamingControl = false,
  onGoLive,
  onStopStream,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onToggleRecording,
  onToggleWhiteboard,
  onSyncWhiteboard,
  isSyncingWhiteboard = false,
  onToggleChat,
  onToggleParticipants,
  onSearch,
  onToggleHandRaise,
  onToggleCaptions,
  captionLanguageTag,
  captionLanguageLabel,
  captionCountry,
  onSelectCaptionLanguage,
  onLeave,
  isNoiseFilterEnabled,
  isNoiseFilterPending,
  showNoiseFilterControl = false,
  noiseFilterDisabled = false,
  noiseFilterUnavailableReason,
  onToggleNoiseFilter,
  backgroundMode = "none",
  backgroundImagePath = null,
  backgroundSupported = false,
  backgroundProcessing = false,
  onBackgroundNone,
  onBackgroundBlur,
  onBackgroundImage,
}: TopControlBarProps) {
  const [copied, setCopied] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

  const [meetingDuration, setMeetingDuration] = useState(0);
  useEffect(() => {
    if (!meetingStartTime) return;
    const timer = setInterval(() => {
      setMeetingDuration(Math.floor((Date.now() - meetingStartTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [meetingStartTime]);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q) onSearch?.(q);
  }, [searchInput, onSearch]);

  return (
    <header className="relative safe-top flex items-center gap-0 h-11 px-3 bg-neutral-200/96 backdrop-blur-2xl animate-header-pill-in">

      {/* ── Left: Meeting info ── */}
      <div className="flex items-center gap-2 shrink-0 pr-3">
        {/* Connection dot */}
        <div className="relative flex items-center justify-center shrink-0" title={connectionQuality}>
          <div className={cn("h-1.5 w-1.5 rounded-full", connectionDotColor[connectionQuality])} />
          {connectionQuality === "excellent" && (
            <div className={cn("absolute h-1.5 w-1.5 animate-ping rounded-full opacity-40", connectionDotColor[connectionQuality])} />
          )}
        </div>

        {/* Meeting code */}
        <span className="font-mono text-xs font-semibold tracking-wide text-neutral-800">
          {code}
        </span>

        {/* Copy link */}
        <button
          onClick={handleCopyLink}
          className="hidden sm:flex h-5 w-5 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-300/70 hover:text-neutral-700 shrink-0"
          title={copied ? "Copied!" : "Copy meeting link"}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>

        {/* Participants + duration */}
        <div className="hidden sm:flex items-center gap-1.5 text-neutral-500">
          <Users className="h-3 w-3" />
          <span className="text-xs font-medium text-neutral-600">{participantCount}</span>
          <span className="text-neutral-400">·</span>
          <span className="font-mono text-xs text-neutral-500">{formatDuration(meetingDuration)}</span>
        </div>
      </div>

      <Divider />

      {/* ── Center: Search + AV controls ── */}
      <div className="flex flex-1 items-center justify-center gap-1 px-1">

        {/* Search bar */}
        {onSearch && (
          <>
            <form
              onSubmit={handleSearchSubmit}
              className="hidden sm:flex items-center gap-1.5 rounded-xl bg-white/60 px-2.5 py-1 ring-1 ring-neutral-200/70 w-[180px] transition-all focus-within:bg-white/80 focus-within:ring-accent-400/40"
            >
              <Search className="h-3 w-3 shrink-0 text-neutral-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search…"
                className="flex-1 bg-transparent text-xs text-neutral-700 placeholder-neutral-400 outline-hidden"
                autoComplete="off"
                spellCheck={false}
              />
              {searchInput && (
                <button type="button" onClick={() => setSearchInput("")} className="text-neutral-400 hover:text-neutral-600">
                  <X className="h-3 w-3" />
                </button>
              )}
            </form>
            <Divider />
          </>
        )}

        {/* AV controls */}
        <div className="flex items-center gap-0.5">
          <BarButton
            icon={isMicOn ? Mic : MicOff}
            label={isMicOn ? "Mute" : "Unmute"}
            active={!isMicOn}
            onClick={onToggleMic}
          />
          {showNoiseFilterControl && (
            <BarButton
              icon={AudioWaveform}
              label={isNoiseFilterEnabled ? "Disable noise filter" : "Enable noise filter"}
              tooltip={
                noiseFilterDisabled
                  ? (noiseFilterUnavailableReason ?? "Noise filter is unavailable")
                  : isNoiseFilterEnabled
                    ? "Disable noise filter"
                    : "Enable noise filter"
              }
              active={isNoiseFilterEnabled ?? false}
              disabled={noiseFilterDisabled || isNoiseFilterPending}
              onClick={onToggleNoiseFilter ?? (() => undefined)}
            />
          )}
          <BarButton
            icon={isCameraOn ? Video : VideoOff}
            label={isCameraOn ? "Stop video" : "Start video"}
            active={!isCameraOn}
            onClick={onToggleCamera}
          />
          {backgroundSupported && onBackgroundNone && onBackgroundBlur && onBackgroundImage && (
            <BackgroundEffectButton
              mode={backgroundMode}
              imagePath={backgroundImagePath}
              isProcessing={backgroundProcessing}
              onSelectNone={onBackgroundNone}
              onSelectBlur={onBackgroundBlur}
              onSelectImage={onBackgroundImage}
            />
          )}
          <BarButton
            icon={Monitor}
            label={isScreenSharing ? "Stop presenting" : "Present screen"}
            active={isScreenSharing}
            onClick={onToggleScreenShare}
          />
          {isScreenSharing && (
            <div
              className="flex items-center gap-1 rounded-xl bg-accent-500/15 px-2 py-0.5 ring-1 ring-accent-400/30"
              title="You are presenting"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-500" />
              </span>
              <span className="text-2xs font-semibold tracking-wide text-accent-700">
                Presenting
              </span>
            </div>
          )}

          {showRecordingControl ? (
            <BarButton
              icon={isRecording ? StopRecordIcon : RecordDotIcon}
              label={
                recordingPending
                  ? isRecording ? "Stopping…" : "Starting…"
                  : recordingDisabled && !isRecording
                    ? "Recording unavailable"
                    : isRecording ? "Stop recording" : "Start recording"
              }
              active={isRecording}
              disabled={recordingDisabled && !recordingPending}
              onClick={onToggleRecording}
            />
          ) : isRecording ? (
            <div className="flex items-center gap-1 px-2" title="This meeting is being recorded">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-danger-500" />
              </span>
              <span className="text-xs font-semibold tracking-wide text-danger-400">REC</span>
            </div>
          ) : null}

          {showStreamingControl && (
            <Tooltip content={isRecording ? "Stop recording first to go live" : isStreaming ? "Streaming live" : "Go live"} side="bottom">
              <span>
                <GoLiveButton
                  isStreaming={isStreaming}
                  streamingPending={streamingPending}
                  onGoLive={onGoLive}
                  onStopStream={onStopStream}
                  disabled={!isStreaming && (isRecording || streamingPending)}
                />
              </span>
            </Tooltip>
          )}

          <CountdownTimerButton />
        </div>
      </div>

      <Divider />

      {/* ── Right: Panel toggles + leave ── */}
      <div className="flex items-center gap-0.5 pl-2">
        {onToggleWhiteboard && (
          <BarButton
            icon={SquarePen}
            label={
              whiteboardDisabled
                ? whiteboardDisabledReason || "Whiteboard unavailable"
                : showWhiteboard
                  ? "Close whiteboard"
                  : "Open whiteboard"
            }
            active={showWhiteboard}
            disabled={whiteboardDisabled}
            onClick={onToggleWhiteboard}
          />
        )}
        {showWhiteboard && onSyncWhiteboard && (
          <BarButton
            icon={RefreshCw}
            label={isSyncingWhiteboard ? "Syncing…" : "Sync everyone to this page"}
            disabled={isSyncingWhiteboard}
            className={cn(isSyncingWhiteboard && "animate-spin")}
            onClick={onSyncWhiteboard}
          />
        )}
        <BarButton
          icon={MessageCircle}
          label={showChat ? "Close chat" : "Open chat"}
          active={showChat}
          badge={!showChat ? unreadCount : undefined}
          onClick={onToggleChat}
        />
        <BarButton
          icon={Users}
          label={showParticipants ? "Close panel" : "Show participants"}
          active={showParticipants}
          onClick={onToggleParticipants}
        />
        {onToggleCaptions && (
          <CaptionButton
            showCaptions={showCaptions}
            captionCaptureState={captionCaptureState}
            transcriptPendingCount={transcriptPendingCount}
            transcriptFlushing={transcriptFlushing}
            transcriptFlushFailed={transcriptFlushFailed}
            onToggleCaptions={onToggleCaptions}
            captionLanguageTag={captionLanguageTag}
            captionLanguageLabel={captionLanguageLabel}
            captionCountry={captionCountry}
            onSelectCaptionLanguage={onSelectCaptionLanguage}
          />
        )}
        {onToggleHandRaise && (
          <BarButton
            icon={Hand}
            label={isHandRaised ? "Lower hand" : "Raise hand"}
            active={isHandRaised}
            onClick={onToggleHandRaise}
          />
        )}

        <Divider />

        <BarButton
          icon={PhoneOff}
          label="Leave meeting"
          danger
          onClick={onLeave}
        />
      </div>
    </header>
  );
}
