import * as React from "react";
import { useMaybeRoomContext } from "@livekit/components-react";
import type { Room } from "livekit-client";
import { CheckCircle2, Clock3, Monitor, ShieldCheck, SquarePen, XCircle } from "lucide-react";

import { cn, type StreamingPlatform } from "@ossmeet/shared";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { type HostPermissionRequest, type MeetingRoomState } from "@/lib/meeting/use-meeting-room";
import { captionCaptureCopy } from "@/lib/meeting/caption-state";

function lazyNamedComponent(
  loader: () => Promise<Record<string, unknown>>,
  exportName: string,
) {
  return React.lazy(async () => {
    const module = await loader();
    const component = module[exportName];
    if (!component) {
      throw new Error(`Missing component export: ${exportName}`);
    }
    return { default: component as React.ComponentType<any> };
  });
}

const loadTopControlBarModule = () => import("@/components/meeting/top-control-bar");
const loadCaptionLanguagePickerModule = () => import("@/components/meeting/caption-language-picker");
const loadParticipantsPanelModule = () => import("@/components/meeting/modern-participants-panel");
const loadChatModule = () => import("@/components/meeting/modern-chat");
const loadHandRaisePanelModule = () => import("@/components/meeting/hand-raise-panel");
const loadVideoLayoutModule = () => import("@/components/meeting/modern-video-layout");
const loadCaptionOverlayModule = () => import("@/components/meeting/caption-overlay");
const loadFloatingVideoPipModule = () => import("@/components/meeting/floating-video-pip");
const loadQuantumActionPillModule = () => import("@/components/meeting/quantum-action-pill");
const loadModernMobileParticipantStripModule = () => import("@/components/meeting/modern-mobile-participant-strip");
const loadEndMeetingDialogModule = () => import("@/components/meeting/end-meeting-dialog");

const LazyTopControlBar = lazyNamedComponent(loadTopControlBarModule, "TopControlBar");
const LazyCaptionLanguagePicker = lazyNamedComponent(loadCaptionLanguagePickerModule, "CaptionLanguagePicker");
const LazyModernParticipantsPanel = lazyNamedComponent(loadParticipantsPanelModule, "ModernParticipantsPanel");
const LazyModernLiveChat = lazyNamedComponent(loadChatModule, "ModernLiveChat");
const LazyHandRaisePanel = lazyNamedComponent(loadHandRaisePanelModule, "HandRaisePanel");
const LazyModernVideoGrid = lazyNamedComponent(loadVideoLayoutModule, "ModernVideoGrid");
const LazyModernScreenShareStage = lazyNamedComponent(loadVideoLayoutModule, "ModernScreenShareStage");
const LazyModernVideoSidebar = lazyNamedComponent(loadVideoLayoutModule, "ModernVideoSidebar");
const LazyCaptionOverlay = lazyNamedComponent(loadCaptionOverlayModule, "CaptionOverlay");
const LazyFloatingVideoPip = lazyNamedComponent(loadFloatingVideoPipModule, "FloatingVideoPip");
const LazyQuantumActionPill = lazyNamedComponent(loadQuantumActionPillModule, "QuantumActionPill");
const LazyModernMobileParticipantStrip = lazyNamedComponent(loadModernMobileParticipantStripModule, "ModernMobileParticipantStrip");
const LazyEndMeetingDialog = lazyNamedComponent(loadEndMeetingDialogModule, "EndMeetingDialog");

function SuspenseBoundary({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return <React.Suspense fallback={fallback}>{children}</React.Suspense>;
}

function RoomRefTracker({
  onRoom,
}: {
  onRoom: (room: Room | undefined) => void;
}) {
  const room = useMaybeRoomContext();
  React.useEffect(() => {
    onRoom(room);
  }, [room, onRoom]);
  return null;
}

/**
 * Only surfaces actionable caption problems that need user intervention.
 * Normal states (idle, listening, starting, mic-muted, unsupported) are
 * already communicated via the CC popover status pill — no need for a
 * duplicate overlay. Shown only for: permission-denied, network-error,
 * audio-error, language-unsupported.
 */
function CaptionCaptureNotice({
  state,
}: {
  state: MeetingRoomState["captionCaptureState"];
}) {
  if (
    state === "idle" ||
    state === "listening" ||
    state === "starting" ||
    state === "mic-muted" ||
    state === "unsupported"
  ) {
    return null;
  }

  const status = captionCaptureCopy[state];

  return (
    <div className="safe-bottom pointer-events-none absolute inset-x-0 bottom-16 z-40 px-4 text-center">
      <div className="mx-auto max-w-md rounded-lg bg-black/75 px-4 py-3 text-sm text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm">
        <div className="font-medium">{status.label}</div>
        <div className="mt-1 text-xs leading-5 text-white/70">{status.description}</div>
      </div>
    </div>
  );
}

function HostPermissionDock({
  requests,
  onApproveScreenShare,
  onDenyScreenShare,
  onApproveExtraPermission,
  onDenyExtraPermission,
  compact = false,
}: {
  requests: HostPermissionRequest[];
  onApproveScreenShare: (userId: string) => void;
  onDenyScreenShare: (userId: string) => void;
  onApproveExtraPermission?: (userId: string) => void;
  onDenyExtraPermission?: (userId: string) => void;
  compact?: boolean;
}) {
  if (requests.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "border border-stone-200/85 bg-[#fcfaf6]/96 backdrop-blur-xl",
          compact
            ? "rounded-[22px] p-2.5 shadow-[0_16px_36px_-24px_rgba(41,37,36,0.28)]"
            : "rounded-[26px] p-3 shadow-[0_22px_50px_-26px_rgba(41,37,36,0.32)]",
        )}
      >
        <div className={cn("flex items-center gap-2", compact ? "mb-2 px-0.5" : "mb-2 px-1")}>
          <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 ring-1 ring-teal-100">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-stone-800">
              {compact ? "Requests" : "Access requests"}
            </div>
            {!compact && (
              <div className="text-xs text-stone-500">
                Review permissions without covering the canvas.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {requests.map((request) => {
            const isScreenShare = request.kind === "screen-share";
            return (
              <div
                key={request.id}
                className={cn(
                  "rounded-2xl border border-stone-200/80 bg-white/90 shadow-sm",
                  compact ? "p-2.5" : "p-3",
                )}
              >
                <div className={cn("flex items-start", compact ? "gap-2.5" : "gap-3")}>
                  <div
                    className={cn(
                      "mt-0.5 flex shrink-0 items-center justify-center rounded-2xl ring-1",
                      compact ? "h-8 w-8" : "h-9 w-9",
                      isScreenShare
                        ? "bg-sky-50 text-sky-600 ring-sky-100"
                        : "bg-amber-50 text-amber-600 ring-amber-100",
                    )}
                  >
                    {isScreenShare ? <Monitor className="h-4 w-4" /> : <SquarePen className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn("font-semibold text-stone-800", compact ? "text-xs" : "text-sm")}>
                      {request.userName}
                    </div>
                    <div className={cn("mt-0.5 text-stone-500", compact ? "text-[11px] leading-4" : "text-xs")}>
                      {isScreenShare ? "Wants to share their screen" : "Requested whiteboard edit access"}
                    </div>
                  </div>
                </div>

                <div className={cn("flex items-center justify-end gap-2", compact ? "mt-2.5" : "mt-3")}>
                  <button
                    type="button"
                    aria-label={`Deny ${isScreenShare ? "screen share" : "whiteboard access"} for ${request.userName}`}
                    onClick={() =>
                      isScreenShare
                        ? onDenyScreenShare(request.userId)
                        : onDenyExtraPermission?.(request.userId)
                    }
                    className={cn(
                      "rounded-xl border border-stone-200 bg-stone-50 font-medium text-stone-600 transition-colors hover:bg-stone-100",
                      compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
                    )}
                  >
                    Deny
                  </button>
                  <button
                    type="button"
                    aria-label={`Approve ${isScreenShare ? "screen share" : "whiteboard access"} for ${request.userName}`}
                    onClick={() =>
                      isScreenShare
                        ? onApproveScreenShare(request.userId)
                        : onApproveExtraPermission?.(request.userId)
                    }
                    className={cn(
                      "rounded-xl font-medium text-white transition-colors",
                      compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
                      isScreenShare ? "bg-teal-600 hover:bg-teal-500" : "bg-amber-500 hover:bg-amber-400",
                    )}
                  >
                    Approve
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ParticipantPermissionBanner({
  state,
  isPreparing,
  hasPrepared,
  hasPermission,
  onCancel,
}: {
  state: "idle" | "pending" | "denied" | "approved";
  isPreparing: boolean;
  hasPrepared: boolean;
  hasPermission: boolean;
  onCancel: () => void;
}) {
  if (state === "idle") return null;

  const tone =
    state === "denied"
      ? {
          shell: "border-rose-200/80 bg-rose-50/95",
          icon: "bg-rose-100 text-rose-600 ring-rose-200/80",
          title: "text-rose-700",
          body: "text-rose-600",
        }
      : state === "approved"
        ? {
            shell: "border-emerald-200/80 bg-emerald-50/95",
            icon: "bg-emerald-100 text-emerald-600 ring-emerald-200/80",
            title: "text-emerald-700",
            body: "text-emerald-600",
          }
        : {
            shell: "border-stone-200/80 bg-[#fcfaf6]/96",
            icon: "bg-teal-50 text-teal-600 ring-teal-100",
            title: "text-stone-800",
            body: "text-stone-500",
          };

  const copy =
    state === "pending"
      ? {
          icon: Clock3,
          title: isPreparing ? "Choose what to share" : "Waiting for approval",
          body: isPreparing
            ? "Pick a window or tab. We’ll send the request as soon as your selection is ready."
            : hasPrepared
              ? "Your host will review the screen-share request."
              : "Preparing your screen-share request.",
          action: "Cancel",
        }
      : state === "approved"
        ? {
            icon: CheckCircle2,
            title: "Screen share approved",
            body: hasPermission
              ? "Starting your share now."
              : "Approval arrived. Syncing permission to your browser.",
            action: "Dismiss",
          }
        : {
            icon: XCircle,
            title: "Screen share denied",
            body: "The host declined this request. You can try again later.",
            action: "Dismiss",
          };

  const Icon = copy.icon;

  return (
    <div className="absolute left-1/2 top-16 z-[125] w-[min(92vw,30rem)] -translate-x-1/2 md:top-20">
      <div
        className={cn(
          "rounded-[24px] border p-3 shadow-[0_18px_40px_-22px_rgba(41,37,36,0.35)] backdrop-blur-xl",
          tone.shell,
        )}
      >
        <div className="flex items-start gap-3">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ring-1", tone.icon)}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className={cn("text-sm font-semibold", tone.title)}>{copy.title}</div>
            <div className={cn("mt-1 text-xs leading-5", tone.body)}>{copy.body}</div>
          </div>
          <button
            onClick={onCancel}
            className="rounded-xl border border-stone-200/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-white"
          >
            {copy.action}
          </button>
        </div>
      </div>
    </div>
  );
}

function SurfaceUnavailableOverlay({
  disabledByConfig,
  disabledReason,
  error,
  onClose,
}: {
  disabledByConfig?: boolean;
  disabledReason?: string | null;
  error?: boolean;
  onClose?: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center"
      style={{ background: "rgba(245, 244, 242, 0.95)", backdropFilter: "blur(24px)" }}
    >
      <div className="liquid-glass-soft mx-6 w-full max-w-sm rounded-3xl p-8 text-center">
        {disabledByConfig ? (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
              <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z"
                />
              </svg>
            </div>
            <p className="text-base font-semibold text-stone-800">Whiteboard unavailable</p>
            <p className="mt-2 text-sm text-stone-500">
              {disabledReason || "Continuing without the shared canvas."}
            </p>
            <button
              onClick={() => onClose?.()}
              className="mt-5 rounded-xl bg-stone-100 px-5 py-2.5 text-sm font-medium text-stone-700 transition-all hover:bg-stone-200"
            >
              Continue meeting
            </button>
          </>
        ) : error ? (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <p className="text-base font-semibold text-stone-800">Canvas unavailable</p>
            <p className="mt-2 text-sm text-stone-500">Continuing without the shared canvas.</p>
            <button
              onClick={() => onClose?.()}
              className="mt-5 rounded-xl bg-stone-100 px-5 py-2.5 text-sm font-medium text-stone-700 transition-all hover:bg-stone-200"
            >
              Continue meeting
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-50 to-teal-100 shadow-sm">
              <div className="liquid-spinner-light" />
            </div>
            <p className="text-base font-semibold text-stone-800">Preparing canvas...</p>
            <p className="mt-2 text-sm text-stone-500">Setting up your shared workspace</p>
            <div className="mt-4 flex justify-center gap-1">
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: "0ms" }} />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: "150ms" }} />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: "300ms" }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export interface MeetingExtensions {
  surface?: {
    content: React.ReactNode;
    show: boolean;
    canMount: boolean;
    loading?: boolean;
    error?: boolean;
    disabledByConfig?: boolean;
    disabledReason?: string | null;
    onClose?: () => void;
  };
  surfaceToolbar?: {
    active?: boolean;
    onToggle?: () => void;
    onSync?: () => void;
    isSyncing?: boolean;
    disabled?: boolean;
    disabledReason?: string | null;
  };
  extraPermissions?: HostPermissionRequest[];
  onApproveExtraPermission?: (userId: string) => void;
  onDenyExtraPermission?: (userId: string) => void;
  leaveOverlay?: React.ReactNode;
  searchPanel?: React.ReactNode;
  onAddImage?: (imageUrl: string) => Promise<void>;
  forceParticipantStrip?: boolean;
}

export function MeetingRoomLayout({
  meeting,
  extensions,
}: {
  meeting: MeetingRoomState;
  extensions?: MeetingExtensions;
}) {
  const surface = extensions?.surface;
  const surfaceToolbar = extensions?.surfaceToolbar;

  const surfaceRequested = surface?.show ?? false;
  const surfaceLoading = surface?.loading ?? false;
  const surfaceError = surface?.error ?? false;
  const surfaceDisabledByConfig = surface?.disabledByConfig ?? false;
  const surfaceReady =
    surfaceRequested && !surfaceLoading && !surfaceError && !surfaceDisabledByConfig;
  const showScreenShareStage = meeting.hasScreenShare;
  const showSurfaceContent = surfaceReady && !showScreenShareStage;
  const hostPermissionRequests = React.useMemo(
    () => [...meeting.hostPermissionRequests, ...(extensions?.extraPermissions ?? [])],
    [meeting.hostPermissionRequests, extensions?.extraPermissions],
  );
  const showBottomRequestTray =
    meeting.canModerate && hostPermissionRequests.length > 0 && surfaceRequested;
  const desktopPanelRightOffsetClass = meeting.showVideoSidebar
    ? "right-[calc(200px+0.75rem)] lg:right-[calc(240px+0.75rem)]"
    : "right-3";
  const showNoiseFilterControl = meeting.hasNoiseFilterFeature;
  const noiseFilterUnavailableReason = !meeting.isMicOn
    ? "Unmute your microphone to use the noise filter"
    : meeting.noiseFilterStatus === "starting"
      ? "Noise filter is starting"
      : meeting.noiseFilterStatus === "unsupported"
        ? (meeting.noiseFilterError ?? "Noise filter is not supported in this browser")
        : meeting.noiseFilterStatus === "fallback"
          ? (meeting.noiseFilterError ?? "Noise filter failed; using browser audio cleanup")
          : null;
  const handleToggleNoiseFilter = meeting.canToggleNoiseFilter
    ? () => {
        const enabling = !meeting.isNoiseFilterEnabled;
        meeting.setNoiseFilterEnabled(enabling).catch((err) => {
          meeting.addToast({
            title: "Noise filter failed",
            description:
              err instanceof Error
                ? err.message
                : "Could not update the noise filter.",
            data: { variant: "error" },
          });
        });
      }
    : undefined;

  return (
    <div ref={meeting.mediaScopeRef} className="relative h-dvh overflow-hidden liquid-meeting-bg">
      <RoomRefTracker onRoom={meeting.handleRoomUpdate} />

      {(meeting.showConnectingOverlay || meeting.isLiveKitConnecting || meeting.isLiveKitReconnecting) && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{
            background: "rgba(245, 244, 242, 0.95)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
          }}
        >
          <div className="liquid-glass-glow rounded-3xl px-12 py-9 text-center">
            <div className="liquid-spinner-light mx-auto mb-4" />
            <p className="font-medium text-stone-600">{meeting.connectionOverlayLabel}</p>
          </div>
        </div>
      )}

      <SuspenseBoundary>
        <LazyEndMeetingDialog
          show={meeting.showEndConfirm}
          onCancel={() => meeting.setShowEndConfirm(false)}
          onLeave={meeting.canHostManage ? meeting.confirmLeave : undefined}
          onConfirm={meeting.confirmEnd}
        />
      </SuspenseBoundary>

      {extensions?.leaveOverlay}

      <div
        className={cn(
          "absolute inset-0 overflow-hidden transition-all duration-500",
          !meeting.isPhone && "top-11",
        )}
      >
        {surfaceRequested ? (
          <>
            {showSurfaceContent ? null : showScreenShareStage ? (
              <div className="flex h-full">
                <div className="min-h-0 flex-1">
                  <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                    <LazyModernScreenShareStage />
                  </SuspenseBoundary>
                </div>
                {meeting.showVideoSidebar && (
                  <div className="flex h-full w-[200px] shrink-0 flex-col border-l border-stone-200 bg-white shadow-[-4px_0_24px_-4px_rgba(0,0,0,0.08)] lg:w-[240px]">
                    <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                      <LazyModernVideoSidebar
                        presence={meeting.presenceParticipants}
                        includeScreenShare={false}
                        videoDevices={meeting.videoDevices}
                        currentVideoDeviceId={meeting.currentVideoDeviceId}
                        onSelectVideoDevice={meeting.handleSelectVideoDevice}
                        onRefreshVideoDevices={meeting.refreshVideoDevices}
                      />
                    </SuspenseBoundary>
                  </div>
                )}
              </div>
            ) : (
              <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                <LazyModernVideoGrid
                  presence={meeting.presenceParticipants}
                  videoDevices={meeting.videoDevices}
                  currentVideoDeviceId={meeting.currentVideoDeviceId}
                  onSelectVideoDevice={meeting.handleSelectVideoDevice}
                  onRefreshVideoDevices={meeting.refreshVideoDevices}
                />
              </SuspenseBoundary>
            )}

            <div
              className={cn(
                "absolute inset-0 flex h-full transition-opacity duration-500 ease-out",
                showSurfaceContent ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            >
              <div
                className={cn(
                  "relative z-10 min-h-0 min-w-0 flex-1 overflow-hidden",
                  meeting.isPhone && "w-full",
                )}
                style={{
                  // Whiteboard surface should be white to match the actual
                  // canvas the user expects — not a beige shell that looks
                  // like a fake overlay when the whiteboard hasn't fully
                  // rendered yet.
                  background: "#ffffff",
                  paddingTop: meeting.showParticipantStrip
                    ? "calc(env(safe-area-inset-top, 0px) + 120px)"
                    : undefined,
                  paddingBottom: meeting.isNarrow
                    ? "calc(env(safe-area-inset-bottom, 0px) + 144px)"
                    : "env(safe-area-inset-bottom, 0px)",
                }}
              >
                {surface?.canMount ? surface.content : null}
                {!meeting.isPhone && meeting.ui.showSearch && extensions?.searchPanel && (
                  <div className="absolute right-3 top-3 z-30">
                    {extensions.searchPanel}
                  </div>
                )}
              </div>
              {meeting.showVideoSidebar && (
                <div className="relative flex h-full w-[200px] shrink-0 flex-col border-l border-stone-200 bg-white shadow-[-4px_0_24px_-4px_rgba(0,0,0,0.08)] lg:w-[240px]">
                  <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                    <LazyModernVideoSidebar
                      presence={meeting.presenceParticipants}
                      includeScreenShare={false}
                      videoDevices={meeting.videoDevices}
                      currentVideoDeviceId={meeting.currentVideoDeviceId}
                      onSelectVideoDevice={meeting.handleSelectVideoDevice}
                      onRefreshVideoDevices={meeting.refreshVideoDevices}
                    />
                  </SuspenseBoundary>
                </div>
              )}
            </div>

            {!showScreenShareStage && (surfaceLoading || surfaceError || surfaceDisabledByConfig) && (
              <SurfaceUnavailableOverlay
                disabledByConfig={surfaceDisabledByConfig}
                disabledReason={surface?.disabledReason}
                error={surfaceError}
                onClose={surface?.onClose}
              />
            )}
          </>
        ) : meeting.hasScreenShare ? (
          <div className="flex h-full">
            <div className="min-h-0 flex-1">
              <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                <LazyModernScreenShareStage />
              </SuspenseBoundary>
            </div>
            {meeting.showVideoSidebar && (
              <div className="relative flex h-full w-[200px] shrink-0 flex-col border-l border-stone-200/80 bg-[#f8f4ee]/92 backdrop-blur-xl lg:w-[240px]">
                <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                  <LazyModernVideoSidebar
                    presence={meeting.presenceParticipants}
                    includeScreenShare={false}
                    videoDevices={meeting.videoDevices}
                    currentVideoDeviceId={meeting.currentVideoDeviceId}
                    onSelectVideoDevice={meeting.handleSelectVideoDevice}
                    onRefreshVideoDevices={meeting.refreshVideoDevices}
                  />
                </SuspenseBoundary>
              </div>
            )}
          </div>
        ) : (
          <SuspenseBoundary fallback={<div className="h-full w-full" />}>
            <LazyModernVideoGrid
              presence={meeting.presenceParticipants}
              videoDevices={meeting.videoDevices}
              currentVideoDeviceId={meeting.currentVideoDeviceId}
              onSelectVideoDevice={meeting.handleSelectVideoDevice}
              onRefreshVideoDevices={meeting.refreshVideoDevices}
            />
          </SuspenseBoundary>
        )}
      </div>

      {meeting.showParticipantStrip &&
        (meeting.isPhone || extensions?.forceParticipantStrip) &&
        !(meeting.isPhone && meeting.hasScreenShare) && (
          <SuspenseBoundary>
            <LazyModernMobileParticipantStrip
              videoDevices={meeting.videoDevices}
              currentVideoDeviceId={meeting.currentVideoDeviceId}
              onSelectVideoDevice={meeting.handleSelectVideoDevice}
              onRefreshVideoDevices={meeting.refreshVideoDevices}
            />
          </SuspenseBoundary>
        )}

      {meeting.isPhone && (
        <SuspenseBoundary>
          <LazyQuantumActionPill
            isMicOn={meeting.isMicOn}
            isCameraOn={meeting.isCameraOn}
            isScreenSharing={meeting.isScreenSharing}
            showWhiteboard={surfaceToolbar?.active}
            showChat={meeting.ui.showChat}
            showParticipants={meeting.ui.showParticipants}
            unreadCount={meeting.ui.chatUnreadCount}
            onToggleMic={() => {
              const lp = meeting.roomInstance?.localParticipant;
              lp?.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
            }}
            onToggleCamera={() => {
              const lp = meeting.roomInstance?.localParticipant;
              lp?.setCameraEnabled(!lp.isCameraEnabled);
            }}
            onToggleScreenShare={meeting.handleToggleScreenShare}
            onToggleWhiteboard={surfaceToolbar?.onToggle}
            onToggleChat={meeting.ui.handleToggleChat}
            onToggleParticipants={meeting.ui.handleToggleParticipants}
            onOpenCaptionLanguage={
              meeting.speechSupported ? () => meeting.setShowCaptionLanguagePicker(true) : undefined
            }
            showCaptions={meeting.showCaptions}
            onToggleCaptions={meeting.handleToggleCaptions}
            captionCaptureState={meeting.captionCaptureState}
            backgroundMode={meeting.bgEffect.mode}
            backgroundImagePath={meeting.bgEffect.imagePath}
            backgroundSupported={meeting.bgEffect.isSupported}
            backgroundProcessing={meeting.bgEffect.isProcessing}
            onBackgroundNone={meeting.bgEffect.clearEffect}
            onBackgroundBlur={meeting.bgEffect.setBlur}
            onBackgroundImage={meeting.bgEffect.setImage}
            isNoiseFilterEnabled={meeting.isNoiseFilterEnabled}
            showNoiseFilterControl={showNoiseFilterControl}
            noiseFilterDisabled={!meeting.canToggleNoiseFilter || meeting.isNoiseFilterPending}
            noiseFilterUnavailableReason={noiseFilterUnavailableReason}
            onToggleNoiseFilter={handleToggleNoiseFilter}
            onLeave={meeting.canHostManage ? meeting.handleEnd : meeting.handleLeave}
            isRecording={meeting.isRecording}
            recordingDisabled={!meeting.recordingEnabled || !meeting.canHostManage || meeting.recordingPending || meeting.isStreaming}
            onToggleRecording={meeting.canHostManage ? meeting.handleToggleRecording : undefined}
            isStreaming={meeting.isStreaming}
            streamingPending={meeting.streamingPending}
            streamingDisabled={!meeting.canHostManage || meeting.streamingPending || (!meeting.isStreaming && meeting.isRecording)}
            onGoLive={meeting.canHostManage ? (platform: StreamingPlatform, streamKey: string) => meeting.handleToggleStreaming(platform, streamKey) : undefined}
            onStopStream={meeting.canHostManage ? () => meeting.handleToggleStreaming("twitch", "") : undefined}
          />
        </SuspenseBoundary>
      )}

      {!meeting.isPhone && (
        <div
          className={cn(
            "absolute inset-x-0 top-0 z-[110] transition-opacity duration-300",
            !meeting.ui.controlsVisible && "pointer-events-none opacity-0",
          )}
        >
          <SuspenseBoundary>
            <LazyTopControlBar
              code={meeting.code}
              meetingStartTime={meeting.meetingStartTime}
              participantCount={meeting.presenceParticipants.length}
              connectionQuality={meeting.connectionQuality}
              isMicOn={meeting.isMicOn}
              isCameraOn={meeting.isCameraOn}
              isScreenSharing={meeting.isScreenSharing}
              isRecording={meeting.isRecording}
              recordingPending={meeting.recordingPending}
              showWhiteboard={surfaceToolbar?.active}
              showChat={meeting.ui.showChat}
              showParticipants={meeting.ui.showParticipants}
              unreadCount={meeting.ui.chatUnreadCount}
              isHandRaised={meeting.isHandRaised}
              whiteboardDisabled={surfaceToolbar?.disabled}
              whiteboardDisabledReason={surfaceToolbar?.disabledReason}
              recordingDisabled={!meeting.recordingEnabled || !meeting.canHostManage || meeting.recordingPending || meeting.isStreaming}
              onToggleMic={() => {
                const lp = meeting.roomInstance?.localParticipant;
                lp?.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
              }}
              onToggleCamera={() => {
                const lp = meeting.roomInstance?.localParticipant;
                lp?.setCameraEnabled(!lp.isCameraEnabled);
              }}
              onToggleScreenShare={meeting.handleToggleScreenShare}
              onToggleRecording={meeting.handleToggleRecording}
              showRecordingControl={meeting.canHostManage}
              onToggleWhiteboard={surfaceToolbar?.onToggle}
              onSyncWhiteboard={meeting.canModerate ? surfaceToolbar?.onSync : undefined}
              isSyncingWhiteboard={surfaceToolbar?.isSyncing}
              showCaptions={meeting.showCaptions}
              captionCaptureState={meeting.captionCaptureState}
              transcriptPendingCount={meeting.transcriptPendingCount}
              transcriptFlushing={meeting.transcriptFlushing}
              transcriptFlushFailed={meeting.transcriptFlushFailed}
              onToggleCaptions={meeting.handleToggleCaptions}
              captionLanguageTag={meeting.captionLanguage}
              captionLanguageLabel={meeting.captionLanguageLabel}
              captionCountry={meeting.captionCountry}
              onSelectCaptionLanguage={meeting.speechSupported ? meeting.setCaptionLanguage : undefined}
              onToggleChat={meeting.ui.handleToggleChat}
              onToggleParticipants={meeting.ui.handleToggleParticipants}
              onSearch={meeting.ui.handleSearch}
              onToggleHandRaise={meeting.ui.handleHandRaiseAction}
              onLeave={meeting.canHostManage ? meeting.handleEnd : meeting.handleLeave}
              isNoiseFilterEnabled={meeting.isNoiseFilterEnabled}
              isNoiseFilterPending={meeting.isNoiseFilterPending}
              showNoiseFilterControl={showNoiseFilterControl}
              noiseFilterDisabled={!meeting.canToggleNoiseFilter || meeting.isNoiseFilterPending}
              noiseFilterUnavailableReason={noiseFilterUnavailableReason}
              onToggleNoiseFilter={handleToggleNoiseFilter}
              backgroundMode={meeting.bgEffect.mode}
              backgroundImagePath={meeting.bgEffect.imagePath}
              backgroundSupported={meeting.bgEffect.isSupported}
              backgroundProcessing={meeting.bgEffect.isProcessing}
              onBackgroundNone={meeting.bgEffect.clearEffect}
              onBackgroundBlur={meeting.bgEffect.setBlur}
              onBackgroundImage={meeting.bgEffect.setImage}
              isStreaming={meeting.isStreaming}
              streamingPending={meeting.streamingPending}
              showStreamingControl={meeting.canHostManage}
              onGoLive={(platform: StreamingPlatform, streamKey: string) => meeting.handleToggleStreaming(platform, streamKey)}
              onStopStream={() => meeting.handleToggleStreaming("twitch", "")}
            />
          </SuspenseBoundary>
        </div>
      )}

      {meeting.hasScreenShare && !meeting.isPhone && !meeting.showVideoSidebar && (
        <SuspenseBoundary>
          <LazyFloatingVideoPip />
        </SuspenseBoundary>
      )}

      {meeting.showCaptions && meeting.captions.length > 0 && (
        <SuspenseBoundary>
          <LazyCaptionOverlay captions={meeting.captions} />
        </SuspenseBoundary>
      )}
      {meeting.showCaptions && <CaptionCaptureNotice state={meeting.captionCaptureState} />}

      {meeting.canModerate && hostPermissionRequests.length > 0 && !showBottomRequestTray && (
        <div className="absolute right-4 top-16 z-[125] w-[min(22rem,calc(100vw-2rem))] md:top-20">
          <HostPermissionDock
            requests={hostPermissionRequests}
            onApproveScreenShare={meeting.handleApproveScreenShare}
            onDenyScreenShare={meeting.handleDenyScreenShare}
            onApproveExtraPermission={extensions?.onApproveExtraPermission}
            onDenyExtraPermission={extensions?.onDenyExtraPermission}
          />
        </div>
      )}

      {showBottomRequestTray && (
        <div
          className="absolute left-1/2 z-[130] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2"
          style={{
            bottom: meeting.isPhone
              ? "calc(env(safe-area-inset-bottom, 0px) + 140px)"
              : "calc(env(safe-area-inset-bottom, 0px) + 72px)",
          }}
        >
          <HostPermissionDock
            compact
            requests={hostPermissionRequests}
            onApproveScreenShare={meeting.handleApproveScreenShare}
            onDenyScreenShare={meeting.handleDenyScreenShare}
            onApproveExtraPermission={extensions?.onApproveExtraPermission}
            onDenyExtraPermission={extensions?.onDenyExtraPermission}
          />
        </div>
      )}

      {!meeting.canModerate && (
        <ParticipantPermissionBanner
          state={meeting.screenShareRequestState}
          isPreparing={meeting.isPreparingScreenShare}
          hasPrepared={meeting.hasPreparedScreenShare}
          hasPermission={meeting.hasScreenSharePermission}
          onCancel={meeting.handleCancelScreenShareRequest}
        />
      )}

      {meeting.isPhone ? (
        <>
          <BottomSheet
            open={meeting.ui.showParticipants}
            onClose={() => meeting.ui.setShowParticipants(false)}
            title="Participants"
          >
            <SuspenseBoundary>
              <LazyModernParticipantsPanel
                participants={meeting.participantsList}
                currentUserId={meeting.currentUserId}
                onClose={() => meeting.ui.setShowParticipants(false)}
                hideHeader
                className="h-full rounded-none bg-transparent shadow-none ring-0 backdrop-blur-none"
              />
            </SuspenseBoundary>
          </BottomSheet>
          <BottomSheet open={meeting.ui.showChat} onClose={() => meeting.ui.setShowChat(false)} title="Chat">
            <SuspenseBoundary>
              <LazyModernLiveChat
                messages={meeting.chatMessages}
                currentUserId={meeting.currentUserId}
                onSendMessage={meeting.sendChatMessage}
                onClose={() => meeting.ui.setShowChat(false)}
                hideHeader
                className="h-full rounded-none bg-transparent shadow-none ring-0 backdrop-blur-none"
              />
            </SuspenseBoundary>
          </BottomSheet>
          <BottomSheet
            open={meeting.ui.showSearch}
            onClose={() => meeting.ui.setShowSearch(false)}
            title="Search the internet"
          >
            {extensions?.searchPanel}
          </BottomSheet>
          <BottomSheet
            open={meeting.showCaptionLanguagePicker && meeting.speechSupported}
            onClose={() => meeting.setShowCaptionLanguagePicker(false)}
            title="My spoken language"
          >
            <SuspenseBoundary>
              <LazyCaptionLanguagePicker
                country={meeting.captionCountry}
                selectedLanguage={meeting.captionLanguage}
                onSelectLanguage={(language: string) => {
                  meeting.setCaptionLanguage(language);
                  meeting.setShowCaptionLanguagePicker(false);
                }}
                className="h-full"
                autoFocusSearch
              />
            </SuspenseBoundary>
          </BottomSheet>
          {meeting.canModerate && (
            <BottomSheet
              open={meeting.ui.showHandQueue}
              onClose={() => meeting.ui.setShowHandQueue(false)}
              title="Hand Raises"
            >
              <SuspenseBoundary>
                <LazyHandRaisePanel
                  queue={meeting.handRaiseQueue}
                  onApprove={meeting.approveHandRaise}
                  onDismiss={meeting.dismissHandRaise}
                  onClose={() => meeting.ui.setShowHandQueue(false)}
                />
              </SuspenseBoundary>
            </BottomSheet>
          )}
        </>
      ) : (
        <>
          {meeting.ui.showParticipants && (
            <div className={cn("absolute top-13 bottom-3 z-[100]", desktopPanelRightOffsetClass)}>
              <SuspenseBoundary>
                <LazyModernParticipantsPanel
                  participants={meeting.participantsList}
                  currentUserId={meeting.currentUserId}
                  onClose={() => meeting.ui.setShowParticipants(false)}
                />
              </SuspenseBoundary>
            </div>
          )}
          {meeting.ui.showChat && (
            <div className={cn("absolute top-13 bottom-3 z-[100]", desktopPanelRightOffsetClass)}>
              <SuspenseBoundary>
                <LazyModernLiveChat
                  messages={meeting.chatMessages}
                  currentUserId={meeting.currentUserId}
                  onSendMessage={meeting.sendChatMessage}
                  onClose={() => meeting.ui.setShowChat(false)}
                  className="h-full"
                />
              </SuspenseBoundary>
            </div>
          )}
          {meeting.canModerate && meeting.ui.showHandQueue && (
            <div className={cn("absolute top-13 bottom-3 z-[100]", desktopPanelRightOffsetClass)}>
              <SuspenseBoundary>
                <LazyHandRaisePanel
                  queue={meeting.handRaiseQueue}
                  onApprove={meeting.approveHandRaise}
                  onDismiss={meeting.dismissHandRaise}
                  onClose={() => meeting.ui.setShowHandQueue(false)}
                />
              </SuspenseBoundary>
            </div>
          )}
          {!surfaceRequested && meeting.ui.showSearch && (
            <div className={cn("absolute top-14 z-[100]", desktopPanelRightOffsetClass)}>
              {extensions?.searchPanel}
            </div>
          )}
        </>
      )}
    </div>
  );
}
