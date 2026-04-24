import { useMemo, useState, useCallback } from "react";
import {
  useTracks,
  VideoTrack,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { MicOff, Camera, Check, RefreshCw } from "lucide-react";
import { cn } from "@ossmeet/shared";
import { useResponsive } from "@/lib/hooks/use-responsive";
import { PopoverRoot, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface CameraSwitchButtonProps {
  videoDevices: MediaDeviceInfo[];
  currentDeviceId: string | undefined;
  onSelectDevice: (deviceId: string) => void;
  onRefreshDevices?: () => void;
}

function CameraSwitchButton({
  videoDevices,
  currentDeviceId,
  onSelectDevice,
  onRefreshDevices,
}: CameraSwitchButtonProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback((deviceId: string) => {
    onSelectDevice(deviceId);
    setOpen(false);
  }, [onSelectDevice]);

  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            className="flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white/90 backdrop-blur-sm transition-all hover:bg-black/70 hover:text-white"
            title="Switch camera"
            aria-label="Switch camera"
            onClick={(e) => e.stopPropagation()}
          >
            <Camera className="h-3 w-3" />
          </button>
        }
      />
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={4}
        className="w-52 rounded-lg bg-neutral-950/95 backdrop-blur-2xl border border-white/10 p-2 shadow-2xl"
      >
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-white/70">Switch camera</p>
          {onRefreshDevices && (
            <button
              onClick={onRefreshDevices}
              className="flex h-5 w-5 items-center justify-center rounded text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
              title="Refresh devices"
            >
              <RefreshCw className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {videoDevices.map((device) => (
            <button
              key={device.deviceId}
              onClick={() => handleSelect(device.deviceId)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs transition-all",
                currentDeviceId === device.deviceId
                  ? "bg-accent-500/20 text-accent-300"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              )}
            >
              <div
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded",
                  currentDeviceId === device.deviceId
                    ? "bg-accent-500/30"
                    : "bg-white/10"
                )}
              >
                {currentDeviceId === device.deviceId ? (
                  <Check className="h-2.5 w-2.5" />
                ) : (
                  <Camera className="h-2.5 w-2.5" />
                )}
              </div>
              <span className="truncate flex-1">
                {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}

interface ModernMobileParticipantStripProps {
  videoDevices?: MediaDeviceInfo[];
  currentVideoDeviceId?: string;
  onSelectVideoDevice?: (deviceId: string) => void;
  onRefreshVideoDevices?: () => void;
}

export function ModernMobileParticipantStrip({
  videoDevices = [],
  currentVideoDeviceId,
  onSelectVideoDevice,
  onRefreshVideoDevices,
}: ModernMobileParticipantStripProps) {
  const { isTablet, isLandscape, showParticipantStrip } = useResponsive();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });

  // Sort tracks: Active speaker first, then local
  const sortedTracks = useMemo(
    () =>
      tracks.sort((a, b) => {
        if (a.participant.isLocal) return 1;
        if (b.participant.isLocal) return -1;
        if (a.participant.isSpeaking) return -1;
        if (b.participant.isSpeaking) return 1;
        return 0;
      }),
    [tracks]
  );

  if (!showParticipantStrip || tracks.length === 0) return null;

  // On tablet portrait, sit below the fixed header (48px) with an 8px gap.
  // On phone, sit just below the safe-area inset with an 8px gap.
  const isTabletPortrait = isTablet && !isLandscape;
  const topStyle = isTabletPortrait
    ? "calc(env(safe-area-inset-top, 0px) + 56px)"
    : "calc(env(safe-area-inset-top, 0px) + 8px)";

  return (
    <div
      className="fixed left-0 right-0 z-40 px-3 pointer-events-none"
      style={{ top: topStyle }}
    >
      <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide pointer-events-auto mask-fade-right">
        {sortedTracks.map((track) => (
          <div
            key={track.participant.identity}
            className={cn(
              "relative shrink-0 h-24 w-20 rounded-xl overflow-hidden border transition-all duration-300 shadow-lg",
              track.participant.isSpeaking 
                ? "border-accent-500 ring-1 ring-accent-500/50" 
                : "border-white/10"
            )}
          >
            <VideoTrack
              trackRef={track}
              className={cn(
                "h-full w-full object-cover",
                track.participant.isLocal && "-scale-x-100"
              )}
            />
            
            {/* Overlay Info */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1">
              <p className="text-4xs font-medium text-white truncate">
                {track.participant.name || track.participant.identity}
              </p>
            </div>

            {/* Camera switch for local video - visible when multiple cameras */}
            {track.participant.isLocal && onSelectVideoDevice && videoDevices.length > 1 && (
              <div className="absolute top-1 left-1 opacity-80 hover:opacity-100 transition-opacity">
                <CameraSwitchButton
                  videoDevices={videoDevices}
                  currentDeviceId={currentVideoDeviceId}
                  onSelectDevice={onSelectVideoDevice}
                  onRefreshDevices={onRefreshVideoDevices}
                />
              </div>
            )}

            {!track.participant.isMicrophoneEnabled && (
              <div className="absolute top-1 right-1 h-3.5 w-3.5 rounded-full bg-red-500/80 flex items-center justify-center">
                <MicOff size={8} className="text-white" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
