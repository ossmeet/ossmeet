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
} from "lucide-react";
import { cn } from "@ossmeet/shared";
import { BackgroundEffectButton } from "@/components/meeting/background-effect-picker";

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

import { CaptionLanguagePicker } from "@/components/meeting/caption-language-picker";
import type { BackgroundMode } from "@/lib/meeting/use-background-effect";
import { PopoverRoot, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";

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
  showWhiteboard: boolean;
  showChat: boolean;
  showParticipants: boolean;
  unreadCount: number;
  isHandRaised?: boolean;
  showCaptions?: boolean;
  captionLanguageTag?: string;
  captionLanguageLabel?: string;
  captionCountry?: string | null;
  onSelectCaptionLanguage?: (lang: string) => void;
  whiteboardDisabled?: boolean;
  showRecordingControl?: boolean;
  recordingDisabled?: boolean;
  isNoiseFilterEnabled?: boolean;
  isNoiseFilterPending?: boolean;
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
  onToggleWhiteboard: () => void;
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
  className,
  onClick,
}: BarButtonProps) {
  return (
    <Tooltip content={label} side="bottom">
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
        aria-label={label}
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
  onToggleCaptions,
  captionLanguageTag,
  captionLanguageLabel,
  captionCountry,
  onSelectCaptionLanguage,
}: {
  showCaptions: boolean;
  onToggleCaptions: () => void;
  captionLanguageTag?: string;
  captionLanguageLabel?: string;
  captionCountry?: string | null;
  onSelectCaptionLanguage?: (lang: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const captionButtonElement = (
    <button
      type="button"
      aria-label={showCaptions ? "Caption settings" : "Turn on captions"}
      title={showCaptions ? (captionLanguageLabel ?? "Caption settings") : "Turn on captions"}
      className={cn(
        "relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30",
        showCaptions
          ? "bg-accent-600 text-white shadow-sm"
          : "text-neutral-600 hover:bg-neutral-300/70 hover:text-neutral-900",
      )}
    >
      {showCaptions ? (
        <Captions className="h-4 w-4" strokeWidth={2.5} />
      ) : (
        <CaptionsOff className="h-4 w-4" strokeWidth={1.75} />
      )}
    </button>
  );

  return (
    <div className="relative">
      <PopoverRoot open={open} onOpenChange={setOpen}>
        {showCaptions && onSelectCaptionLanguage ? (
          <PopoverTrigger render={captionButtonElement} />
        ) : (
          <Tooltip
            content={showCaptions ? (captionLanguageLabel ?? "Caption settings") : "Turn on captions"}
            side="bottom"
          >
            <button
              type="button"
              aria-label={showCaptions ? "Caption settings" : "Turn on captions"}
              onClick={onToggleCaptions}
              className={cn(
                "relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30",
                showCaptions
                  ? "bg-accent-600 text-white shadow-sm"
                  : "text-neutral-600 hover:bg-neutral-300/70 hover:text-neutral-900",
              )}
            >
              {showCaptions ? (
                <Captions className="h-4 w-4" strokeWidth={2.5} />
              ) : (
                <CaptionsOff className="h-4 w-4" strokeWidth={1.75} />
              )}
            </button>
          </Tooltip>
        )}
        {showCaptions && onSelectCaptionLanguage && (
          <PopoverContent
            side="bottom"
            align="end"
            className="w-80 rounded-2xl bg-warm-50/98 p-3 shadow-2xl ring-1 ring-warm-200/80 backdrop-blur-xl"
          >
            <div className="mb-2 text-sm font-medium text-warm-700">Caption language</div>
            <CaptionLanguagePicker
              country={captionCountry}
              selectedLanguage={captionLanguageTag ?? "en-US"}
              onSelectLanguage={(lang) => { onSelectCaptionLanguage(lang); setOpen(false); }}
              autoFocusSearch
            />
            <button
              onClick={() => { onToggleCaptions(); setOpen(false); }}
              className="mt-2 w-full rounded-xl px-3 py-2 text-left text-sm text-red-500 transition-colors hover:bg-red-50/80"
            >
              Turn off captions
            </button>
          </PopoverContent>
        )}
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
  showWhiteboard,
  showChat,
  showParticipants,
  unreadCount,
  isHandRaised = false,
  showCaptions = false,
  whiteboardDisabled = false,
  showRecordingControl = true,
  recordingDisabled = false,
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
          {onToggleNoiseFilter && (
            <BarButton
              icon={AudioWaveform}
              label={isNoiseFilterEnabled ? "Disable noise filter" : "Enable noise filter"}
              active={isNoiseFilterEnabled ?? false}
              disabled={isNoiseFilterPending}
              onClick={onToggleNoiseFilter}
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

          <CountdownTimerButton />
        </div>
      </div>

      <Divider />

      {/* ── Right: Panel toggles + leave ── */}
      <div className="flex items-center gap-0.5 pl-2">
        <BarButton
          icon={SquarePen}
          label={whiteboardDisabled ? "Whiteboard unavailable" : showWhiteboard ? "Close whiteboard" : "Open whiteboard"}
          active={showWhiteboard}
          disabled={whiteboardDisabled}
          onClick={onToggleWhiteboard}
        />
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
