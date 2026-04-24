import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@ossmeet/shared";
import { useResponsive } from "@/lib/hooks/use-responsive";
import type { BackgroundMode } from "@/lib/meeting/use-background-effect";
import { BackgroundEffectPicker } from "@/components/meeting/background-effect-picker";

interface ActionPillProps {
  isMicOn: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  showWhiteboard: boolean;
  showChat: boolean;
  showParticipants: boolean;
  unreadCount: number;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleWhiteboard: () => void;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onSearch?: () => void;
  isHandRaised?: boolean;
  onToggleHandRaise?: () => void;
  showCaptions?: boolean;
  onToggleCaptions?: () => void;
  onOpenCaptionLanguage?: () => void;
  isRecording?: boolean;
  recordingDisabled?: boolean;
  onToggleRecording?: () => void;
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
  onToggleCaptions,
  onOpenCaptionLanguage,
  isRecording,
  recordingDisabled,
  onToggleRecording,
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
  const { isPhone } = useResponsive();

  if (!isPhone) return null;

  const handleMoreOpenChange = (open: boolean) => {
    setIsMoreOpen(open);
    if (!open) setShowBackgroundPicker(false);
  };

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-(--z-pill) -translate-x-1/2 transition-all duration-300",
        "w-[94vw] max-w-sm"
      )}
    >
      {/* Main Bar */}
      <div
        className={cn(
          "relative flex items-center justify-between rounded-[2rem] border border-white/10 p-2 shadow-2xl",
          "bg-neutral-900/60 backdrop-blur-[24px] saturate-[140%] shadow-indigo-500/10"
        )}
      >
        <div className="flex items-center gap-1">
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

        <div className="flex items-center gap-1">
          {/* "More" popover — Base UI handles click-outside, focus trap, and a11y */}
          <PopoverRoot open={isMoreOpen} onOpenChange={handleMoreOpenChange}>
            <PopoverTrigger
              render={
                <button
                  className={cn(
                    "relative flex h-12 w-12 items-center justify-center rounded-full transition-all duration-300 active:scale-90",
                    isMoreOpen ? "bg-white/20 text-white" : "bg-white/5 text-white/80"
                  )}
                  aria-label="More options"
                />
              }
            >
              <MoreVertical size={22} strokeWidth={2} />
            </PopoverTrigger>
            <PopoverContent
              side="top"
              sideOffset={16}
              align="center"
              className="w-[94vw] max-w-sm rounded-3xl bg-neutral-950/80 backdrop-blur-2xl border border-white/10 p-4 shadow-2xl origin-(--transform-origin) transition-[transform,scale,opacity] data-[instant]:transition-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
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
              ) : (
              <div className="grid grid-cols-4 gap-3">
                <ActionButton
                  icon={SquarePen}
                  label="Whiteboard"
                  active={showWhiteboard}
                  onClick={() => { onToggleWhiteboard(); setIsMoreOpen(false); }}
                  small
                />
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
                    onClick={() => { onToggleCaptions(); setIsMoreOpen(false); }}
                    small
                  />
                )}
                {onOpenCaptionLanguage && (
                  <ActionButton
                    icon={Languages}
                    label="Language"
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

          <div className="mx-1 h-6 w-px bg-white/10" />
          <ActionButton
            icon={PhoneOff}
            label="Leave"
            onClick={onLeave}
            danger
            className="w-14"
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
  small?: boolean;
  className?: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "relative flex flex-col items-center justify-center transition-all duration-300 active:scale-90",
        small ? "h-16 gap-1" : "h-12 w-12 rounded-full",
        !small && (
           danger ? "bg-red-500/80 text-white" :
           active ? "bg-white/20 text-white" :
           accent ? "bg-accent-500/60 text-white" :
           "bg-white/5 text-white/80"
        ),
        small && "rounded-2xl bg-white/5 text-white/60",
        small && active && "bg-white/20 text-white",
        small && danger && "bg-red-500/80 text-white",
        disabled && "opacity-40 pointer-events-none cursor-not-allowed",
        className
      )}
    >
      <Icon size={small ? 20 : 22} strokeWidth={2} />
      {small && <span className="text-2xs font-medium truncate max-w-[90%] text-center leading-tight">{label}</span>}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent-500 px-1 text-4xs font-bold text-white shadow-lg">
          {badge}
        </span>
      )}
    </button>
  );
}
