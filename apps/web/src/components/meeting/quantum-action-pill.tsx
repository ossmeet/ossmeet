import { useEffect, useState } from "react";
import { PopoverRoot, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
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
  MoreVertical,
  Search,
  Hand,
  Captions,
  Languages,
  Circle,
  ChevronLeft,
  Sparkles,
  Radio,
  AudioWaveform,
} from "lucide-react";
import { cn } from "@ossmeet/shared";
import { useResponsive } from "@/lib/hooks/use-responsive";
import type { BackgroundMode } from "@/lib/meeting/use-background-effect";
import { BackgroundEffectPicker } from "@/components/meeting/background-effect-picker";
import { captionCaptureTone, type CaptionCaptureState } from "@/lib/meeting/caption-state";
import type { StreamingPlatform } from "@ossmeet/shared";
import {
  STREAMING_DESTINATIONS,
  readStreamingPreference,
  writeStreamingPreference,
} from "@/lib/meeting/streaming-preferences";

interface ActionPillProps {
  isMicOn: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  showWhiteboard?: boolean;
  showChat: boolean;
  showParticipants: boolean;
  unreadCount: number;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleWhiteboard?: () => void;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onSearch?: () => void;
  isHandRaised?: boolean;
  onToggleHandRaise?: () => void;
  showCaptions?: boolean;
  captionCaptureState?: CaptionCaptureState;
  onToggleCaptions?: () => void;
  onOpenCaptionLanguage?: () => void;
  isRecording?: boolean;
  recordingDisabled?: boolean;
  onToggleRecording?: () => void;
  isNoiseFilterEnabled?: boolean;
  noiseFilterDisabled?: boolean;
  noiseFilterUnavailableReason?: string | null;
  showNoiseFilterControl?: boolean;
  onToggleNoiseFilter?: () => void;
  isStreaming?: boolean;
  streamingPending?: boolean;
  streamingDisabled?: boolean;
  onGoLive?: (platform: StreamingPlatform, streamKey: string) => Promise<void>;
  onStopStream?: () => Promise<void>;
  backgroundMode?: BackgroundMode;
  backgroundImagePath?: string | null;
  backgroundSupported?: boolean;
  backgroundProcessing?: boolean;
  onBackgroundNone?: () => void;
  onBackgroundBlur?: () => void;
  onBackgroundImage?: (path: string) => void;
  onLeave: () => void;
}

export function QuantumActionPill({
  isMicOn,
  isCameraOn,
  isScreenSharing,
  showWhiteboard,
  showChat,
  showParticipants,
  unreadCount,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onToggleWhiteboard,
  onToggleChat,
  onToggleParticipants,
  onSearch,
  isHandRaised,
  onToggleHandRaise,
  showCaptions,
  captionCaptureState = "idle",
  onToggleCaptions,
  onOpenCaptionLanguage,
  isRecording,
  recordingDisabled,
  onToggleRecording,
  isNoiseFilterEnabled,
  noiseFilterDisabled,
  noiseFilterUnavailableReason,
  showNoiseFilterControl,
  onToggleNoiseFilter,
  isStreaming,
  streamingPending,
  streamingDisabled,
  onGoLive,
  onStopStream,
  backgroundMode = "none",
  backgroundImagePath = null,
  backgroundSupported = false,
  backgroundProcessing = false,
  onBackgroundNone,
  onBackgroundBlur,
  onBackgroundImage,
  onLeave,
}: ActionPillProps) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [showBackgroundPicker, setShowBackgroundPicker] = useState(false);
  const [showStreamPanel, setShowStreamPanel] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<StreamingPlatform>("twitch");
  const [streamKey, setStreamKey] = useState("");
  const [streamSubmitting, setStreamSubmitting] = useState(false);
  const { isPhone } = useResponsive();
  const selectedDestination = STREAMING_DESTINATIONS.find((destination) => destination.id === selectedPlatform) ?? STREAMING_DESTINATIONS[0];

  useEffect(() => {
    const saved = readStreamingPreference();
    if (!saved) return;
    setSelectedPlatform(saved.platform);
    setStreamKey(saved.streamKey);
  }, []);

  if (!isPhone) return null;

  const handleMoreOpenChange = (open: boolean) => {
    setIsMoreOpen(open);
    if (!open) {
      setShowBackgroundPicker(false);
      setShowStreamPanel(false);
    }
  };

  const handleStartStream = async () => {
    if (!onGoLive || !streamKey.trim() || streamSubmitting) return;
    setStreamSubmitting(true);
    try {
      const trimmedStreamKey = streamKey.trim();
      writeStreamingPreference({ platform: selectedPlatform, streamKey: trimmedStreamKey });
      await onGoLive(selectedPlatform, trimmedStreamKey);
      setShowStreamPanel(false);
      setIsMoreOpen(false);
    } finally {
      setStreamSubmitting(false);
    }
  };

  const handleStopStream = async () => {
    if (!onStopStream || streamSubmitting) return;
    setStreamSubmitting(true);
    try {
      await onStopStream();
      setIsMoreOpen(false);
    } finally {
      setStreamSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "fixed bottom-3 left-1/2 z-(--z-pill) -translate-x-1/2 transition-all duration-300",
        "w-[92vw] max-w-sm"
      )}
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
    >
      {/* Main Bar */}
      <div
        className={cn(
          "relative flex items-center justify-between rounded-[1.75rem] border border-white/10 px-2.5 py-2 shadow-2xl",
          "bg-neutral-900/70 backdrop-blur-[24px] saturate-[140%] shadow-indigo-500/10"
        )}
      >
        <div className="flex items-center gap-2">
          <ActionButton
            icon={isMicOn ? Mic : MicOff}
            active={!isMicOn}
            onClick={onToggleMic}
            danger={!isMicOn}
          />
          <ActionButton
            icon={isCameraOn ? Video : VideoOff}
            active={!isCameraOn}
            onClick={onToggleCamera}
            danger={!isCameraOn}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* "More" popover — Base UI handles click-outside, focus trap, and a11y */}
          <PopoverRoot open={isMoreOpen} onOpenChange={handleMoreOpenChange}>
            <PopoverTrigger
              render={
                <button
                  className={cn(
                    "relative flex h-11 w-11 items-center justify-center rounded-full transition-all duration-300 active:scale-90",
                    isMoreOpen ? "bg-white/20 text-white" : "bg-white/8 text-white/80"
                  )}
                  aria-label="More options"
                />
              }
            >
              <MoreVertical size={20} strokeWidth={2} />
            </PopoverTrigger>
            <PopoverContent
              side="top"
              sideOffset={16}
              align="center"
              className="w-[92vw] max-w-sm rounded-3xl bg-neutral-950/80 backdrop-blur-2xl border border-white/10 p-4 shadow-2xl origin-(--transform-origin) transition-[transform,scale,opacity] data-[instant]:transition-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
            >
              {showBackgroundPicker && backgroundSupported && onBackgroundNone && onBackgroundBlur && onBackgroundImage ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowBackgroundPicker(false)}
                    className="mb-2 flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                  <BackgroundEffectPicker
                    mode={backgroundMode}
                    imagePath={backgroundImagePath}
                    isProcessing={backgroundProcessing}
                    onSelectNone={() => { onBackgroundNone(); setIsMoreOpen(false); setShowBackgroundPicker(false); }}
                    onSelectBlur={() => { onBackgroundBlur(); setIsMoreOpen(false); setShowBackgroundPicker(false); }}
                    onSelectImage={(path) => { onBackgroundImage(path); setIsMoreOpen(false); setShowBackgroundPicker(false); }}
                  />
                </div>
              ) : showStreamPanel ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowStreamPanel(false)}
                    className="mb-2 flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                  <div className="mb-3 grid grid-cols-4 gap-1.5">
                    {STREAMING_DESTINATIONS.map((platform) => (
                      <button
                        key={platform.id}
                        type="button"
                        onClick={() => setSelectedPlatform(platform.id)}
                        className={cn(
                          "rounded-2xl px-2 py-2 text-xs font-semibold transition-colors",
                          selectedPlatform === platform.id
                            ? "bg-red-500 text-white"
                            : "bg-white/8 text-white/70 hover:bg-white/14 hover:text-white",
                        )}
                      >
                        {platform.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    aria-label={selectedDestination.keyLabel}
                    placeholder={selectedDestination.placeholder}
                    value={streamKey}
                    onChange={(event) => setStreamKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleStartStream();
                    }}
                    className="mb-2 w-full rounded-2xl border border-white/10 bg-white/8 px-3 py-2 text-sm text-white placeholder-white/40 outline-hidden focus:border-red-300/70"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => void handleStartStream()}
                    disabled={!streamKey.trim() || streamSubmitting}
                    className="w-full rounded-2xl bg-red-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {streamSubmitting ? "Starting..." : "Go Live"}
                  </button>
                </div>
              ) : (
              <div className="grid grid-cols-4 gap-3">
                {onToggleWhiteboard && (
                  <ActionButton
                    icon={SquarePen}
                    label="Whiteboard"
                    active={showWhiteboard}
                    onClick={() => { onToggleWhiteboard(); setIsMoreOpen(false); }}
                    small
                  />
                )}
                <ActionButton
                  icon={MessageCircle}
                  label="Chat"
                  active={showChat}
                  badge={unreadCount}
                  onClick={() => { onToggleChat(); setIsMoreOpen(false); }}
                  small
                />
                <ActionButton
                  icon={Users}
                  label="People"
                  active={showParticipants}
                  onClick={() => { onToggleParticipants(); setIsMoreOpen(false); }}
                  small
                />
                <ActionButton
                  icon={Monitor}
                  label="Share"
                  active={isScreenSharing}
                  onClick={() => { onToggleScreenShare(); setIsMoreOpen(false); }}
                  small
                />
                {onSearch && (
                  <ActionButton
                    icon={Search}
                    label="Search"
                    active={false}
                    onClick={() => { onSearch(); setIsMoreOpen(false); }}
                    small
                  />
                )}
                {onToggleHandRaise && (
                  <ActionButton
                    icon={Hand}
                    label="Hand"
                    active={isHandRaised}
                    onClick={() => { onToggleHandRaise(); setIsMoreOpen(false); }}
                    small
                  />
                )}
                {onToggleCaptions && (
                  <ActionButton
                    icon={Captions}
                    label="Captions"
                    active={showCaptions}
                    indicator={showCaptions ? captionCaptureState : undefined}
                    onClick={() => { onToggleCaptions(); setIsMoreOpen(false); }}
                    small
                  />
                )}
                {onOpenCaptionLanguage && (
                  <ActionButton
                    icon={Languages}
                    label="Spoken language"
                    active={false}
                    onClick={() => { onOpenCaptionLanguage(); setIsMoreOpen(false); }}
                    small
                  />
                )}
                {onToggleRecording && (
                  <ActionButton
                    icon={Circle}
                    label="Record"
                    active={isRecording}
                    onClick={() => { onToggleRecording(); setIsMoreOpen(false); }}
                    disabled={recordingDisabled}
                    danger={isRecording}
                    small
                  />
                )}
                {showNoiseFilterControl && (
                  <ActionButton
                    icon={AudioWaveform}
                    label={noiseFilterDisabled ? "Unavailable" : "Noise"}
                    active={isNoiseFilterEnabled}
                    onClick={() => {
                      onToggleNoiseFilter?.();
                      setIsMoreOpen(false);
                    }}
                    title={noiseFilterUnavailableReason ?? "Noise filter"}
                    disabled={noiseFilterDisabled || !onToggleNoiseFilter}
                    small
                  />
                )}
                {(onGoLive || onStopStream) && (
                  <ActionButton
                    icon={Radio}
                    label={isStreaming ? "Live" : "Go Live"}
                    active={isStreaming}
                    onClick={() => {
                      if (isStreaming) {
                        void handleStopStream();
                      } else {
                        setShowStreamPanel(true);
                      }
                    }}
                    disabled={streamingDisabled || streamingPending}
                    danger={isStreaming}
                    small
                  />
                )}
                {backgroundSupported && onBackgroundNone && onBackgroundBlur && onBackgroundImage && (
                  <ActionButton
                    icon={Sparkles}
                    label="Background"
                    active={backgroundMode !== "none"}
                    onClick={() => setShowBackgroundPicker(true)}
                    small
                  />
                )}
              </div>
              )}
            </PopoverContent>
          </PopoverRoot>

          <div className="mx-0.5 h-6 w-px bg-white/10" />
          <ActionButton
            icon={PhoneOff}
            label="Leave"
            onClick={onLeave}
            danger
            className="w-13"
          />
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  active,
  onClick,
  disabled,
  danger,
  accent,
  badge,
  indicator,
  title,
  small = false,
  className,
}: {
  icon: any;
  label?: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
  badge?: number;
  indicator?: CaptionCaptureState;
  title?: string;
  small?: boolean;
  className?: string;
}) {
  return (
    <button
      aria-label={label}
      title={title ?? label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "relative flex flex-col items-center justify-center transition-all duration-300 active:scale-90",
        small ? "h-16 gap-1" : "h-11 w-11 rounded-full",
        !small && (
           danger ? "bg-red-500/80 text-white" :
           active ? "bg-white/20 text-white" :
           accent ? "bg-accent-500/60 text-white" :
           "bg-white/8 text-white/80"
        ),
        small && "rounded-2xl bg-white/5 text-white/60",
        small && active && "bg-white/20 text-white",
        small && danger && "bg-red-500/80 text-white",
        disabled && "opacity-40 pointer-events-none cursor-not-allowed",
        className
      )}
    >
      <Icon size={small ? 20 : 20} strokeWidth={2} />
      {small && <span className="text-2xs font-medium truncate max-w-[90%] text-center leading-tight">{label}</span>}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent-500 px-1 text-4xs font-bold text-white shadow-lg">
          {badge}
        </span>
      )}
      {indicator && (
        <span
          className={cn(
            "absolute right-2 top-2 h-2 w-2 rounded-full ring-2 ring-neutral-950/80",
            captionCaptureTone(indicator),
          )}
          aria-hidden="true"
        />
      )}
    </button>
  );
}
