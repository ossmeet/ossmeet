import { useMemo, useState, useCallback } from "react";
import {
  useTracks,
  useParticipants,
  ParticipantTile,
  VideoTrack,
  isTrackReference,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  Users,
  Mic,
  MicOff,
  Monitor,
  Camera,
  Check,
  RefreshCw,
} from "lucide-react";
import { cn } from "@ossmeet/shared";
import { Avatar } from "@/components/ui/avatar";
import type { ParticipantPresence } from "@/lib/meeting";
import { useResponsive } from "@/lib/hooks/use-responsive";
import { PopoverRoot, PopoverContent, PopoverTrigger } from "@/components/ui/popover";


function filterActiveTracks(
  tracks: ReturnType<typeof useTracks>,
  options: { includeScreenShare?: boolean } = {}
) {
  const { includeScreenShare = true } = options;
  return tracks.filter((trackRef) => {
    if (
      !includeScreenShare &&
      trackRef.source === Track.Source.ScreenShare
    )
      return false;
    if (trackRef.source === Track.Source.ScreenShare) return true;
    if (trackRef.publication) return !trackRef.publication.isMuted;
    return true;
  });
}

function prioritizeTracks(tracks: ReturnType<typeof useTracks>) {
  return [...tracks].sort((a, b) => {
    const aScreenShare = a.source === Track.Source.ScreenShare ? 1 : 0;
    const bScreenShare = b.source === Track.Source.ScreenShare ? 1 : 0;
    if (aScreenShare !== bScreenShare) return bScreenShare - aScreenShare;

    const aLocal = a.participant?.isLocal ? 1 : 0;
    const bLocal = b.participant?.isLocal ? 1 : 0;
    if (aLocal !== bLocal) return bLocal - aLocal;

    const aName = a.participant?.name || a.participant?.identity || "";
    const bName = b.participant?.name || b.participant?.identity || "";
    return aName.localeCompare(bName);
  });
}

export function useActiveVideoTracks(
  options: { includeScreenShare?: boolean } = {}
) {
  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.ScreenShare],
    {
      onlySubscribed: true,
    }
  );
  return prioritizeTracks(filterActiveTracks(tracks, options));
}

export function useActiveScreenShareTracks() {
  const tracks = useTracks([Track.Source.ScreenShare], {
    onlySubscribed: true,
  });
  return prioritizeTracks(filterActiveTracks(tracks));
}

interface CameraSwitchButtonProps {
  videoDevices: MediaDeviceInfo[];
  currentDeviceId: string | undefined;
  onSelectDevice: (deviceId: string) => void;
  onRefreshDevices?: () => void;
  popoverSide?: "top" | "bottom" | "left" | "right";
  popoverAlign?: "start" | "center" | "end";
}

function CameraSwitchButton({
  videoDevices,
  currentDeviceId,
  onSelectDevice,
  onRefreshDevices,
  popoverSide = "top",
  popoverAlign = "end",
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
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white/90 backdrop-blur-md transition-all hover:bg-black/70 hover:text-white"
            title="Switch camera"
            aria-label="Switch camera"
          >
            <Camera className="h-4 w-4" />
          </button>
        }
      />
      <PopoverContent
        side={popoverSide}
        align={popoverAlign}
        sideOffset={8}
        className="w-56 rounded-xl bg-neutral-950/95 backdrop-blur-2xl border border-white/10 p-3 shadow-2xl z-50"
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-white/70">Switch camera</p>
          {onRefreshDevices && (
            <button
              onClick={onRefreshDevices}
              className="flex h-6 w-6 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
              title="Refresh devices"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {videoDevices.map((device) => (
            <button
              key={device.deviceId}
              onClick={() => handleSelect(device.deviceId)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-all",
                currentDeviceId === device.deviceId
                  ? "bg-accent-500/20 text-accent-300"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              )}
            >
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
                  currentDeviceId === device.deviceId
                    ? "bg-accent-500/30"
                    : "bg-white/10"
                )}
              >
                {currentDeviceId === device.deviceId ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Camera className="h-3 w-3" />
                )}
              </div>
              <span className="truncate flex-1 text-xs">
                {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}

export interface VideoGridProps {
  presence?: ParticipantPresence[];
  includeScreenShare?: boolean;
  videoDevices?: MediaDeviceInfo[];
  currentVideoDeviceId?: string;
  onSelectVideoDevice?: (deviceId: string) => void;
  onRefreshVideoDevices?: () => void;
}

export function ModernVideoGrid({
  presence = [],
  includeScreenShare = true,
  videoDevices = [],
  currentVideoDeviceId,
  onSelectVideoDevice,
  onRefreshVideoDevices,
}: VideoGridProps) {
  const { isPhone, isTablet } = useResponsive();
  const activeTracks = useActiveVideoTracks({ includeScreenShare });
  const allParticipants = useParticipants();

  const videoIdentities = useMemo(
    () => new Set(activeTracks.map((t) => t.participant.identity)),
    [activeTracks]
  );

  const presenceById = useMemo(
    () => new Map(presence.map((p) => [p.identity, p])),
    [presence]
  );

  const avatarParticipants = useMemo(
    () =>
      allParticipants
        .filter((p) => !videoIdentities.has(p.identity))
        .sort((a, b) => {
          const aHost = presenceById.get(a.identity)?.role === "host";
          const bHost = presenceById.get(b.identity)?.role === "host";
          if (aHost && !bHost) return -1;
          if (!aHost && bHost) return 1;
          if (a.isLocal && !b.isLocal) return -1;
          if (!a.isLocal && b.isLocal) return 1;
          return (a.name || a.identity).localeCompare(b.name || b.identity);
        }),
    [allParticipants, videoIdentities, presenceById]
  );

  const totalTiles = activeTracks.length + avatarParticipants.length;

  // Dynamic grid layout based on participant count and screen size
  const getGridClass = (count: number, isPhone: boolean, isTablet: boolean) => {
    // Phone: max 2 columns, prioritize vertical scroll
    if (isPhone) {
      if (count === 1) return "grid-cols-1";
      if (count <= 4) return "grid-cols-2 gap-2";
      return "grid-cols-2 gap-2";
    }
    
    // Tablet: max 3 columns
    if (isTablet) {
      if (count === 1) return "grid-cols-1 max-w-2xl";
      if (count <= 2) return "grid-cols-2 gap-3 max-w-4xl";
      if (count <= 6) return "grid-cols-3 gap-3 max-w-5xl";
      return "grid-cols-3 gap-2 max-w-6xl";
    }
    
    // Desktop: original responsive logic
    if (count === 1) return "grid-cols-1 max-w-2xl";
    if (count <= 4) return "grid-cols-2 gap-4 max-w-5xl";
    if (count <= 6) return "grid-cols-3 gap-4 max-w-6xl";
    if (count <= 9) return "grid-cols-3 gap-4 max-w-7xl";
    if (count <= 12) return "grid-cols-4 gap-4 max-w-[1600px]";
    if (count <= 16) return "grid-cols-4 gap-3 max-w-[1800px]";
    return "grid-cols-5 gap-3 max-w-[2000px]";
  };

  const gridClass = getGridClass(totalTiles, isPhone, isTablet);

  if (totalTiles === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="relative text-center rounded-2xl px-10 py-12 bg-warm-50/90 border border-warm-200/60 shadow-lg">
          <div className="mb-4 flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-gradient-to-br from-accent-100 to-accent-50 shadow-sm">
            <Users className="h-7 w-7 text-accent-600" />
          </div>
          <p className="text-base font-semibold text-warm-700">
            Waiting for participants
          </p>
          <p className="mt-2 max-w-xs text-sm text-warm-500">
            Share the meeting code to invite others. They'll appear here when
            they join.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className={cn(
          "grid w-full transition-all duration-300",
          gridClass,
          totalTiles <= 2 && "max-h-[75vh]",
        )}
      >
        {/* Video Tracks */}
        {activeTracks.map((track) => {
          const participantName =
            track.participant.name || track.participant.identity;
          const isSpeaking = track.participant.isSpeaking;

          const isLocal = track.participant.isLocal;
          return (
            <div
            key={
              track.publication?.trackSid ||
              `${track.participant.identity}-${track.source}`
            }
            className={cn(
              "group relative overflow-hidden rounded-3xl bg-warm-900 transition-all duration-300",
              "ring-1 ring-warm-700/30 shadow-md",
              isSpeaking && "ring-2 ring-accent-400 shadow-accent-400/15",
              totalTiles === 1 && (isPhone ? "aspect-[3/4]" : "aspect-video"),
              totalTiles > 1 && (isPhone ? "aspect-square" : "aspect-video"),
            )}
          >
              <ParticipantTile
                trackRef={track}
                className={cn(
                  "h-full w-full object-cover [&_video]:object-cover [&_video]:w-full [&_video]:h-full",
                  isLocal && "[&_video]:-scale-x-100"
                )}
                disableSpeakingIndicator={false}
              />

              {/* Subtle hover gradient */}
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none" />

              {/* Name & Status Bar */}
              <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between pointer-events-none">
                <div className="flex items-center gap-1.5 rounded-lg bg-warm-950/30 px-1.5 py-0.5 backdrop-blur-sm transition-colors group-hover:bg-warm-950/40 pointer-events-auto">
                  <span className="max-w-[100px] truncate text-2xs font-medium text-warm-100/90 drop-shadow-sm sm:max-w-[150px]">
                    {participantName}
                    {track.participant.isLocal && (
                      <span className="ml-1 font-normal text-warm-300/80">
                        (You)
                      </span>
                    )}
                  </span>
                </div>

                {/* Mic status */}
                <div className="relative flex h-6 w-6 items-center justify-center pointer-events-auto">
                  {isSpeaking && track.participant.isMicrophoneEnabled && (
                    <span className="absolute inset-0 rounded-full bg-emerald-500/40 animate-ping" />
                  )}
                  <div
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-xl transition-colors backdrop-blur-md",
                      track.participant.isMicrophoneEnabled
                        ? "bg-emerald-500/20"
                        : "bg-red-500/30 border border-red-500/20",
                    )}
                  >
                    {track.participant.isMicrophoneEnabled ? (
                      <Mic className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <MicOff className="h-3 w-3 text-red-300" />
                    )}
                  </div>
                </div>
              </div>

              {/* Screen share indicator */}
              {track.source === Track.Source.ScreenShare && (
                <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-xl bg-warm-950/60 px-2.5 py-1.5 backdrop-blur-sm">
                  <Monitor className="h-3.5 w-3.5 text-accent-400" />
                  <span className="text-xs font-medium text-warm-100">
                    Presenting
                  </span>
                </div>
              )}

              {/* Camera switch button - only for local video, visible when multiple cameras */}
              {isLocal && track.source === Track.Source.Camera && onSelectVideoDevice && videoDevices.length > 1 && (
                <div className="absolute right-3 top-3 z-10 opacity-70 transition-opacity duration-200 hover:opacity-100">
                  <CameraSwitchButton
                    videoDevices={videoDevices}
                    currentDeviceId={currentVideoDeviceId}
                    onSelectDevice={onSelectVideoDevice}
                    onRefreshDevices={onRefreshVideoDevices}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Avatar Participants (no video) */}
        {avatarParticipants.map((p) => (
          <div
            key={p.identity}
            className={cn(
              "group relative flex flex-col items-center justify-center rounded-3xl bg-gradient-to-br from-warm-100 to-warm-200 transition-all duration-300",
              "ring-1 ring-warm-300/50 shadow-md",
              p.isSpeaking && p.isMicrophoneEnabled && "ring-2 ring-accent-400 shadow-accent-400/15",
              totalTiles === 1 && "aspect-video",
              totalTiles > 1 && "aspect-video",
            )}
          >
            {/* Animated background gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-accent-500/5 via-transparent to-amber-500/5 opacity-0 transition-opacity group-hover:opacity-100 rounded-2xl" />

            <div className="relative flex flex-col items-center gap-3">
              <Avatar
                name={p.name || p.identity || "User"}
                size="xl"
                className="h-20 w-20 ring-4 ring-warm-100 shadow-md"
              />

              <div className="text-center">
                <span className="block max-w-[160px] truncate text-base font-semibold text-warm-700">
                  {p.name || p.identity}
                  {p.isLocal && (
                    <span className="ml-1.5 text-sm text-warm-400">
                      (You)
                    </span>
                  )}
                </span>

                <div className="mt-2 flex items-center justify-center gap-2">
                  {p.isMicrophoneEnabled ? (
                    <div className="relative flex items-center gap-1.5 rounded-xl bg-emerald-100/80 px-2.5 py-1 ring-1 ring-emerald-200/60">
                      {p.isSpeaking && (
                        <span className="absolute inset-0 rounded-xl bg-emerald-400/30 animate-ping" />
                      )}
                      <Mic className="h-3 w-3 text-emerald-600" />
                      <span className="text-xs font-medium text-emerald-700">
                        On mic
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-xl bg-red-100/80 px-2.5 py-1 ring-1 ring-red-200/60">
                      <MicOff className="h-3 w-3 text-red-500" />
                      <span className="text-xs font-medium text-red-600">
                        Muted
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface VideoSidebarProps {
  presence?: ParticipantPresence[];
  includeScreenShare?: boolean;
  videoDevices?: MediaDeviceInfo[];
  currentVideoDeviceId?: string;
  onSelectVideoDevice?: (deviceId: string) => void;
  onRefreshVideoDevices?: () => void;
}

export function ModernVideoSidebar({
  presence = [],
  includeScreenShare = true,
  videoDevices = [],
  currentVideoDeviceId,
  onSelectVideoDevice,
  onRefreshVideoDevices,
}: VideoSidebarProps) {
  const activeTracks = useActiveVideoTracks({ includeScreenShare });
  const allParticipants = useParticipants();

  const videoIdentities = useMemo(
    () => new Set(activeTracks.map((t) => t.participant.identity)),
    [activeTracks]
  );

  const presenceById = useMemo(
    () => new Map(presence.map((p) => [p.identity, p])),
    [presence]
  );

  const avatarParticipants = useMemo(
    () =>
      allParticipants
        .filter((p) => !videoIdentities.has(p.identity))
        .sort((a, b) => {
          const aHost = presenceById.get(a.identity)?.role === "host";
          const bHost = presenceById.get(b.identity)?.role === "host";
          if (aHost && !bHost) return -1;
          if (!aHost && bHost) return 1;
          if (a.isLocal && !b.isLocal) return -1;
          if (!a.isLocal && b.isLocal) return 1;
          return (a.name || a.identity).localeCompare(b.name || b.identity);
        }),
    [allParticipants, videoIdentities, presenceById]
  );

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {activeTracks.map((track) => {
        const participantName =
          track.participant.name || track.participant.identity;
        const isLocal = track.participant.isLocal;

        return (
          <div
            key={
              track.publication?.trackSid ||
              `${track.participant.identity}-${track.source}`
            }
            className="group relative aspect-video w-full overflow-hidden rounded-xl bg-stone-900 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.15)] transition-all hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.2)]"
          >
            <ParticipantTile
              trackRef={track}
              className={cn(
                "h-full w-full object-cover [&_video]:object-cover [&_video]:w-full [&_video]:h-full",
                isLocal && "[&_video]:-scale-x-100"
              )}
              disableSpeakingIndicator={true}
            />

            {/* Name label */}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 rounded-lg bg-black/60 px-2 py-1 pointer-events-auto min-w-0 flex-1">
                <span className="truncate text-xs font-medium text-white">
                  {participantName}
                  {track.participant.isLocal && <span className="font-normal text-white/70"> (You)</span>}
                </span>
              </div>

              {/* Camera switch button - only for local video, visible when multiple cameras */}
              {isLocal && track.source === Track.Source.Camera && onSelectVideoDevice && videoDevices.length > 1 && (
                <div className="opacity-70 transition-opacity duration-200 hover:opacity-100 pointer-events-auto shrink-0">
                  <CameraSwitchButton
                    videoDevices={videoDevices}
                    currentDeviceId={currentVideoDeviceId}
                    onSelectDevice={onSelectVideoDevice}
                    onRefreshDevices={onRefreshVideoDevices}
                    popoverSide="left"
                    popoverAlign="start"
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {avatarParticipants.map((p) => (
        <div
          key={p.identity}
          className="flex w-full items-center gap-3 rounded-xl bg-stone-50 p-3 border border-stone-200 transition-all hover:bg-white hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] hover:border-stone-300"
        >
          <Avatar name={p.name || p.identity || "User"} size="md" className="ring-2 ring-white shadow-sm" />
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-medium text-stone-800">
              {p.name || p.identity}
              {p.isLocal && <span className="text-stone-500 font-normal"> (You)</span>}
            </div>
            <div className="mt-1 flex items-center gap-2">
              {p.isMicrophoneEnabled ? (
                <div className="relative flex items-center justify-center">
                  {p.isSpeaking && (
                    <span className="absolute inset-0 rounded-full bg-emerald-500/30 animate-ping" />
                  )}
                  <Mic className="h-3 w-3 text-emerald-500" />
                </div>
              ) : (
                <MicOff className="h-3 w-3 text-stone-400" />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ModernScreenShareStage() {
  const { isPhone } = useResponsive();
  const screenShareTracks = useActiveScreenShareTracks();
  const primaryTrack = screenShareTracks.find(isTrackReference);
  const cameraTracks = useTracks([Track.Source.Camera], {
    onlySubscribed: true,
  });
  const mobileOverlayTracks = useMemo(() => {
    if (!isPhone) return [];

    return [...cameraTracks]
      .filter((trackRef) => trackRef.publication && !trackRef.publication.isMuted)
      .sort((a, b) => {
        const aPrimary = a.participant.identity === primaryTrack?.participant.identity ? 1 : 0;
        const bPrimary = b.participant.identity === primaryTrack?.participant.identity ? 1 : 0;
        if (aPrimary !== bPrimary) return bPrimary - aPrimary;

        const aLocal = a.participant.isLocal ? 1 : 0;
        const bLocal = b.participant.isLocal ? 1 : 0;
        if (aLocal !== bLocal) return bLocal - aLocal;

        const aSpeaking = a.participant.isSpeaking ? 1 : 0;
        const bSpeaking = b.participant.isSpeaking ? 1 : 0;
        if (aSpeaking !== bSpeaking) return bSpeaking - aSpeaking;

        const aName = a.participant.name || a.participant.identity || "";
        const bName = b.participant.name || b.participant.identity || "";
        return aName.localeCompare(bName);
      })
      .slice(0, 2);
  }, [cameraTracks, isPhone, primaryTrack?.participant.identity]);

  if (!primaryTrack) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="relative">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-32 animate-pulse rounded-full bg-accent-500/10 blur-3xl" />
          </div>

          <div className="liquid-glass-glow relative flex flex-col items-center rounded-3xl px-8 py-12 text-center" style={{ boxShadow: '0 24px 48px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500/20 to-accent-600/20">
              <Monitor className="h-8 w-8 text-accent-500" />
            </div>
            <p className="text-lg font-semibold text-warm-800">
              No screen share active
            </p>
            <p className="mt-2 max-w-xs text-sm text-warm-500">
              Waiting for someone to share their screen.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center bg-black",
        isPhone
          ? "px-0 pb-[calc(env(safe-area-inset-bottom,0px)+88px)] pt-[calc(env(safe-area-inset-top,0px)+8px)]"
          : "p-2 sm:p-4"
      )}
    >
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center overflow-hidden bg-black shadow-2xl ring-1 ring-white/10",
          isPhone ? "rounded-none" : "max-w-[1800px] rounded-2xl"
        )}
      >
        <VideoTrack
          trackRef={primaryTrack}
          className="h-full w-full object-contain bg-black"
        />

        {isPhone && mobileOverlayTracks.length > 0 && (
          <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] gap-2">
            {mobileOverlayTracks.map((trackRef) => (
              <div
                key={trackRef.participant.identity}
                className="relative h-20 w-16 overflow-hidden rounded-xl border border-white/10 bg-stone-950/90 shadow-lg backdrop-blur-sm"
              >
                <VideoTrack
                  trackRef={trackRef}
                  className={cn(
                    "h-full w-full object-cover",
                    trackRef.participant.isLocal && "-scale-x-100"
                  )}
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1">
                  <p className="truncate text-3xs font-medium text-white">
                    {trackRef.participant.name || trackRef.participant.identity}
                    {trackRef.participant.isLocal && " (You)"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Presenter info */}
        <div
          className={cn(
            "absolute left-4 bottom-4 flex items-center gap-2 rounded-xl bg-black/70 backdrop-blur-sm",
            isPhone ? "px-3 py-2" : "px-4 py-2.5"
          )}
        >
          <div
            className={cn(
              "flex items-center justify-center rounded-full bg-accent-500/20",
              isPhone ? "h-7 w-7" : "h-8 w-8"
            )}
          >
            <Monitor className={cn("text-accent-400", isPhone ? "h-3.5 w-3.5" : "h-4 w-4")} />
          </div>
          <div>
            <p className={cn("font-medium text-white", isPhone ? "text-xs" : "text-sm")}>
              {primaryTrack.participant.name ||
                primaryTrack.participant.identity}
              {primaryTrack.participant.isLocal && " (You)"}
            </p>
            <p className={cn("text-neutral-400", isPhone ? "text-2xs" : "text-xs")}>is presenting</p>
          </div>
        </div>
      </div>
    </div>
  );
}
