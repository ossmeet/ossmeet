import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useMaybeRoomContext,
  useLocalParticipant,
  useConnectionState,
  useTracks,
} from "@livekit/components-react";
import {
  ConnectionState,
  RoomEvent,
  Track,
  VideoPresets,
  type LocalTrack,
  DisconnectReason,
  type RoomConnectOptions,
  type RoomOptions,
  type Room,
} from "livekit-client";

import { CheckCircle2, Clock3, Monitor, ShieldCheck, SquarePen, XCircle } from "lucide-react";
import { cn } from "@ossmeet/shared";
import { PreJoinScreen } from "@/components/meeting/pre-join-screen";
import {
  useLiveKitChat,
  useLiveKitPresence,
  useLiveKitHandRaises,
  useLiveKitReactions,
  useLiveKitCaptions,
  useLiveKitScreenShare,
  useTranscriptBuffer,
  hasAdminGrant,
  type ReactionEvent,
} from "@/lib/meeting";
import { useSpeechRecognition, type SpeechTranscriptMeta } from "@/lib/meeting/use-speech-recognition";
import { useBackgroundEffect } from "@/lib/meeting/use-background-effect";
import { useAudioCancellation } from "@/lib/meeting/use-audio-cancellation";
import { logError, logWarn } from "@/lib/logger-client";
import { markMeetingEntryMetric } from "@/lib/meeting/entry-metrics";
import { preloadMeetingWhiteboardModule } from "@/lib/meeting/preload-whiteboard";
import { notifyMeetingLeave } from "@/lib/meeting/leave-beacon";
import { saveSpeechLanguage, speechLanguageDisplayName, SPEECH_LANGUAGE_OPTIONS } from "@/lib/meeting/speech-languages";
import { joinMeeting } from "@/server/meetings/join";
import { leaveMeeting, endMeeting } from "@/server/meetings/leave-end";
import { grantScreenShare } from "@/server/meetings/screen-share";
import { getClientMeetingHints } from "@/server/client-hints";
import { refreshMeetingToken } from "@/server/meetings/tokens";
import { toggleRecording } from "@/server/meetings/recording";
import { approveWhiteboardWrite, denyWhiteboardWrite } from "@/server/meetings/whiteboard";
import { sessionQueryOptions } from "@/queries/session";
import type { MeetingWhiteboardHandle, PendingWriteRequest } from "@/lib/meeting/types";
import { useResponsive } from "@/lib/hooks/use-responsive";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useMeetingLifecycle } from "@/lib/meeting/use-meeting-lifecycle";
import { useWhiteboardSession } from "@/lib/meeting/use-whiteboard-session";
import { useMeetingUI } from "@/lib/meeting/use-meeting-ui";
import { installRtcConfigurationSanitizer, sanitizeRtcConfiguration } from "@/lib/meeting/rtc-config-sanitizer";
import {
  getMeetingTokenRefreshDelayMs,
  TOKEN_REFRESH_BUFFER_MS,
  getMeetingTokenRefreshFailureMessage,
  getMeetingTokenRetryDelayMs,
} from "@/lib/meeting/token-refresh";
import type { JoinResult } from "@/lib/meeting/types";

installRtcConfigurationSanitizer();

const SCREEN_SHARE_PERMISSION_SOURCE = 3;

function hasScreenSharePublishPermission(
  participant: { permissions?: { canPublishSources?: number[] } } | null | undefined
) {
  return participant?.permissions?.canPublishSources?.includes(SCREEN_SHARE_PERMISSION_SOURCE) ?? false;
}

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
const loadWikiSearchPanelModule = () => import("@/components/meeting/wiki-search-panel");
const loadQuantumActionPillModule = () => import("@/components/meeting/quantum-action-pill");
const loadModernMobileParticipantStripModule = () => import("@/components/meeting/modern-mobile-participant-strip");
const loadEndMeetingDialogModule = () => import("@/components/meeting/end-meeting-dialog");
const loadLeavePdfDialogModule = () => import("@/components/meeting/leave-pdf-dialog");

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
const LazyWikiSearchPanel = lazyNamedComponent(loadWikiSearchPanelModule, "WikiSearchPanel");
const LazyQuantumActionPill = lazyNamedComponent(loadQuantumActionPillModule, "QuantumActionPill");
const LazyModernMobileParticipantStrip = lazyNamedComponent(loadModernMobileParticipantStripModule, "ModernMobileParticipantStrip");
const LazyEndMeetingDialog = lazyNamedComponent(loadEndMeetingDialogModule, "EndMeetingDialog");
const LazyLeavePdfDialog = lazyNamedComponent(loadLeavePdfDialogModule, "LeavePdfDialog");

const LazyMeetingWhiteboard = React.lazy(async () => {
  const module = await preloadMeetingWhiteboardModule();
  return { default: module.MeetingWhiteboard };
});

function preloadMeetingRoomUi() {
  return Promise.all([
    loadTopControlBarModule(),
    loadCaptionLanguagePickerModule(),
    loadParticipantsPanelModule(),
    loadChatModule(),
    loadHandRaisePanelModule(),
    loadVideoLayoutModule(),
    loadCaptionOverlayModule(),
    loadFloatingVideoPipModule(),
    loadWikiSearchPanelModule(),
    loadQuantumActionPillModule(),
    loadModernMobileParticipantStripModule(),
    loadEndMeetingDialogModule(),
    loadLeavePdfDialogModule(),
  ]);
}

function SuspenseBoundary({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return <React.Suspense fallback={fallback}>{children}</React.Suspense>;
}

type HostPermissionRequest =
  | { kind: "screen-share"; id: string; userId: string; userName: string }
  | { kind: "whiteboard-write"; id: string; userId: string; userName: string };

function HostPermissionDock({
  requests,
  onApproveScreenShare,
  onDenyScreenShare,
  onApproveWhiteboard,
  onDenyWhiteboard,
  compact = false,
}: {
  requests: HostPermissionRequest[];
  onApproveScreenShare: (userId: string) => void;
  onDenyScreenShare: (userId: string) => void;
  onApproveWhiteboard: (userId: string) => void;
  onDenyWhiteboard: (userId: string) => void;
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
            : "rounded-[26px] p-3 shadow-[0_22px_50px_-26px_rgba(41,37,36,0.32)]"
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
              <div className="text-xs text-stone-500">Review permissions without covering the canvas.</div>
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
                  compact ? "p-2.5" : "p-3"
                )}
              >
                <div className={cn("flex items-start", compact ? "gap-2.5" : "gap-3")}>
                  <div
                    className={cn(
                      "mt-0.5 flex shrink-0 items-center justify-center rounded-2xl ring-1",
                      compact ? "h-8 w-8" : "h-9 w-9",
                      isScreenShare
                        ? "bg-sky-50 text-sky-600 ring-sky-100"
                        : "bg-amber-50 text-amber-600 ring-amber-100"
                    )}
                  >
                    {isScreenShare ? <Monitor className="h-4 w-4" /> : <SquarePen className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn("font-semibold text-stone-800", compact ? "text-xs" : "text-sm")}>
                      {request.userName}
                    </div>
                    <div className={cn("mt-0.5 text-stone-500", compact ? "text-[11px] leading-4" : "text-xs")}>
                      {isScreenShare ? "Wants to share their screen" : "Requested whiteboard write access"}
                    </div>
                  </div>
                </div>

                <div className={cn("flex items-center justify-end gap-2", compact ? "mt-2.5" : "mt-3")}>
                  <button
                    type="button"
                    onClick={() =>
                      isScreenShare ? onDenyScreenShare(request.userId) : onDenyWhiteboard(request.userId)
                    }
                    className={cn(
                      "rounded-xl border border-stone-200 bg-stone-50 font-medium text-stone-600 transition-colors hover:bg-stone-100",
                      compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
                    )}
                  >
                    Deny
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      isScreenShare ? onApproveScreenShare(request.userId) : onApproveWhiteboard(request.userId)
                    }
                    className={cn(
                      "rounded-xl font-medium text-white transition-colors",
                      compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
                      isScreenShare ? "bg-teal-600 hover:bg-teal-500" : "bg-amber-500 hover:bg-amber-400"
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
      <div className={cn("rounded-[24px] border p-3 shadow-[0_18px_40px_-22px_rgba(41,37,36,0.35)] backdrop-blur-xl", tone.shell)}>
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

export const Route = createLazyFileRoute("/$code")({
  component: MeetingRoute,
});

const ROOM_OPTIONS: RoomOptions = {
  dynacast: true,
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
    facingMode: "user",
  },
  audioCaptureDefaults: {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
  },
  publishDefaults: {
    videoSimulcastLayers: [
      VideoPresets.h180,
      VideoPresets.h360,
      VideoPresets.h540,
      VideoPresets.h720,
    ],
    screenShareSimulcastLayers: [VideoPresets.h720, VideoPresets.h1080],
    dtx: true,
    red: true,
    stopMicTrackOnMute: false,
    videoEncoding: {
      maxBitrate: 2_500_000,
      maxFramerate: 30,
    },
    screenShareEncoding: {
      maxBitrate: 5_000_000,
      maxFramerate: 30,
    },
  },
  adaptiveStream: true,
  disconnectOnPageLeave: true,
};

interface JoinSettings {
  videoDeviceId?: string;
  audioDeviceId?: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  captionLanguage: string;
}

type MeetingPhase = "prejoin" | "joining" | "connecting" | "connected" | "error";
const CONNECTING_TIMEOUT_MS = 20_000;
const WAITING_POLL_INTERVAL_MS = 5_000;
const GUEST_RECONNECT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SPECULATIVE_CREDENTIAL_AGE_MS = 90_000;
const GUEST_RECONNECT_STORAGE_PREFIX = "ossmeet.guest.";
const AUTH_RECONNECT_STORAGE_PREFIX = "ossmeet.auth.participant.";

function getGuestReconnectStorageKey(code: string) {
  return `${GUEST_RECONNECT_STORAGE_PREFIX}${code}`;
}

function getAuthReconnectStorageKey(code: string) {
  return `${AUTH_RECONNECT_STORAGE_PREFIX}${code}`;
}

function loadReconnectParticipantId(code: string, isAuthenticated: boolean): string | undefined {
  if (isAuthenticated) {
    try {
      return sessionStorage.getItem(getAuthReconnectStorageKey(code)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  try {
    const stored = localStorage.getItem(getGuestReconnectStorageKey(code));
    if (!stored) return undefined;
    const parsed = JSON.parse(stored) as {
      participantId?: string;
      updatedAt?: number;
    };
    if (
      typeof parsed.participantId === "string" &&
      typeof parsed.updatedAt === "number" &&
      Date.now() - parsed.updatedAt < GUEST_RECONNECT_TTL_MS
    ) {
      return parsed.participantId;
    }
    localStorage.removeItem(getGuestReconnectStorageKey(code));
  } catch {
    // ignore corrupt storage
  }

  return undefined;
}

function persistReconnectParticipantId(
  code: string,
  participantId: string,
  isGuest: boolean,
): void {
  try {
    if (isGuest) {
      localStorage.setItem(getGuestReconnectStorageKey(code), JSON.stringify({
        participantId,
        updatedAt: Date.now(),
      }));
      return;
    }

    sessionStorage.setItem(getAuthReconnectStorageKey(code), participantId);
  } catch {
    // storage may be unavailable
  }
}

function clearReconnectParticipantId(code: string, isAuthenticated: boolean): void {
  try {
    if (isAuthenticated) {
      sessionStorage.removeItem(getAuthReconnectStorageKey(code));
      return;
    }

    localStorage.removeItem(getGuestReconnectStorageKey(code));
  } catch {
    // storage may be unavailable
  }
}

/**
 * Camera tracks always use H.264.
 * H.264 is hardware-encoded on all modern desktops (VideoToolbox on Mac,
 * MediaFoundation on Windows) giving instant ramp-up to the target resolution.
 * VP9 (libvpx) is always software-encoded, takes 12–17 s to reach 720p even
 * at 3 Mbps, and peaks at ~180 % CPU on Windows laptops.
 */
function resolveCameraCodec(): "h264" {
  return "h264";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}

/**
 * Screen sharing codec selection:
 * - Safari: always H.264. VP9 encoding is unreliable before Safari 17, and the
 *   LiveKit SFU disables VP9 publish for Safari > 18.3 anyway. H.264 is
 *   hardware-encoded via VideoToolbox on every Apple device, so there is no
 *   downside. The Chrome H.264 keyframe/FIR bug does not affect Safari.
 * - Windows: VP9 (AV1 can flicker on some GPU/driver combos with tab capture).
 * - Other platforms: AV1 when the browser can encode it, VP9 otherwise.
 *   AV1 keeps text sharp at low bitrates.
 */
function resolveScreenShareCodec(): "h264" | "av1" | "vp9" {
  if (typeof navigator === "undefined") return "vp9";

  const ua = navigator.userAgent || "";
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  if (isSafari) return "h264";

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
  if (/win/i.test(platform)) return "vp9";

  if (
    typeof RTCRtpSender === "undefined" ||
    typeof RTCRtpSender.getCapabilities !== "function"
  ) {
    return "vp9";
  }
  const caps = RTCRtpSender.getCapabilities("video");
  const supportsAv1 = caps?.codecs?.some(
    (c) => c.mimeType.toLowerCase() === "video/av1"
  );
  return supportsAv1 ? "av1" : "vp9";
}

function shouldPreferLegacyPeerConnection(): boolean {
  return false;
}

const SUPPORTED_BROWSER_BASELINES = {
  chromium: 120,
  firefox: 115,
  safari: 16,
  ios: 16,
} as const;

function getMajorVersionFromUa(ua: string, pattern: RegExp): number {
  const match = ua.match(pattern);
  if (!match) return Number.NaN;
  return Number.parseInt(match[1] ?? "", 10);
}

function getLegacyBrowserBlockReason(): string | null {
  if (typeof navigator === "undefined") return null;

  const ua = navigator.userAgent || "";
  const lower = ua.toLowerCase();

  // In-app browsers (Instagram, Facebook, TikTok, WeChat, Snapchat, LinkedIn,
  // Twitter/X) strip or break getUserMedia and WebRTC. Detect before anything
  // else so users get a useful message instead of a cryptic WebRTC failure.
  if (
    /instagram|fbav|fban|fb_iab|fbiab|twitter|snapchat|linkedin|wechat|micromessenger|tiktok|bytedance/i.test(ua)
  ) {
    return "This in-app browser doesn't support video calls. Open this link in Safari or Chrome to join.";
  }

  const isAppleMobile = /iphone|ipad|ipod/.test(lower);

  // iPhone 6-class devices cap out far below our supported iOS 16 baseline.
  const majorIos = getMajorVersionFromUa(ua, /OS (\d+)_/i);
  if (isAppleMobile && Number.isFinite(majorIos) && majorIos < SUPPORTED_BROWSER_BASELINES.ios) {
    return "This iOS Safari version is not supported. Use iOS 16+ Safari (or a newer device) to join meetings.";
  }

  const majorEdge = getMajorVersionFromUa(ua, /Edg\/(\d+)/i);
  if (Number.isFinite(majorEdge) && majorEdge < SUPPORTED_BROWSER_BASELINES.chromium) {
    return "This Edge version is not supported. Use Edge 120+ to join meetings.";
  }

  const majorFirefox = getMajorVersionFromUa(ua, /Firefox\/(\d+)/i);
  if (Number.isFinite(majorFirefox) && majorFirefox < SUPPORTED_BROWSER_BASELINES.firefox) {
    return "This Firefox version is not supported. Use Firefox 115+ to join meetings.";
  }

  const majorChrome = getMajorVersionFromUa(ua, /Chrome\/(\d+)/i);
  if (
    Number.isFinite(majorChrome) &&
    !Number.isFinite(majorEdge) &&
    majorChrome < SUPPORTED_BROWSER_BASELINES.chromium
  ) {
    return "This Chromium-based browser version is not supported. Use Chrome/Edge 120+ to join meetings.";
  }

  // Safari uses Version/<major> in user-agent.
  const majorSafari = getMajorVersionFromUa(ua, /Version\/(\d+)/i);
  if (
    Number.isFinite(majorSafari) &&
    ua.includes("Safari") &&
    !ua.includes("Chrome") &&
    !ua.includes("Chromium") &&
    !ua.includes("Edg") &&
    majorSafari < SUPPORTED_BROWSER_BASELINES.safari
  ) {
    return "This Safari version is not supported. Use Safari 16+ to join meetings.";
  }

  return null;
}

function MeetingRoute() {
  const { code } = Route.useParams();
  const { lookup } = Route.useLoaderData();
  const navigate = useNavigate();
  const [phase, setPhase] = React.useState<MeetingPhase>("prejoin");
  const [waitingForHost, setWaitingForHost] = React.useState(false);
  const [joinResult, setJoinResult] = React.useState<JoinResult | null>(null);
  const [joinSettings, setJoinSettings] = React.useState<JoinSettings | null>(null);
  const [shouldConnectRoom, setShouldConnectRoom] = React.useState(false);
  const [useLegacyPeerConnection, setUseLegacyPeerConnection] = React.useState<boolean>(() =>
    shouldPreferLegacyPeerConnection()
  );
  const [error, setError] = React.useState<string | null>(null);
  const intentionalDisconnectRef = React.useRef(false);
  const hasConnectedRef = React.useRef(false);
  const attemptedLegacyFallbackRef = React.useRef(false);
  const failedConnectLeaveIssuedRef = React.useRef<string | null>(null);
  const joinAttemptIdRef = React.useRef(0);
  const pollJoinInFlightRef = React.useRef(false);
  // Tracks the real wall-clock time the meeting connected. Stored here (not in
  // TopControlBar) so it survives any re-mount of child components.
  const meetingStartTimeRef = React.useRef<number>(0);
  // Speculative join: for authenticated users we fire joinMeeting as soon as
  // sessionData is available, before the user clicks the Join button.
  // This overlaps the token round-trip with camera device enumeration.
  const speculativeJoinRef = React.useRef<Promise<Awaited<ReturnType<typeof joinMeeting>> | null> | null>(null);
  const speculativeJoinResolvedAtRef = React.useRef<number | null>(null);
  const speculativeJoinFiredRef = React.useRef(false);
  // IDs of an unconsumed speculative-join participant row. Set when the
  // speculative joinMeeting resolves; cleared when attemptJoin consumes the
  // result. If still set on unmount/pagehide, we fire leaveMeeting so the row
  // doesn't ghost the meeting (blocks finalize-on-empty, eats cap slots).
  const speculativeOrphanRef = React.useRef<{ meetingId: string; participantId: string } | null>(null);
  // Auto-rejoin after one unintentional disconnect, before surfacing an error.
  // LiveKit's SDK already retries reconnection internally; this kicks in only
  // when the SDK has given up — typically a longer outage. One free try beats
  // making the user click "Try again" for every flaky-network blip.
  const autoRejoinAttemptedRef = React.useRef(false);
  const meetingEndedExternallyRef = React.useRef<(() => Promise<void>) | null>(null);
  const lastJoinDisplayNameRef = React.useRef<string | null>(null);

  const { data: sessionData } = useQuery(sessionQueryOptions());
  const authenticatedUser = sessionData?.user ? { name: sessionData.user.name } : undefined;

  React.useEffect(() => {
    markMeetingEntryMetric("routeMountedAt", { code });
    preloadMeetingWhiteboardModule().catch(() => {});
  }, [code]);

  // Prevent iOS Safari from scrolling the page (URL bar collapse) while in a meeting.
  // body.meet-route { overflow: hidden } is defined in styles.css but must be applied here.
  // Only apply once inside the room — not during the pre-join screen, which needs scrolling.
  React.useEffect(() => {
    if (phase !== "connected") return;
    document.body.classList.add("meet-route");
    return () => document.body.classList.remove("meet-route");
  }, [phase]);

  // As soon as we know the user is authenticated, speculatively call joinMeeting
  // in the background. By the time the user clicks Join (after camera preview
  // loads), the token should already be ready — eliminating the ~300-500ms
  // round-trip from the click-to-connect critical path.
  // Only fires once per mount; errors are silently ignored (normal join retries).
  const speculativeUserName = sessionData?.user?.name;
  React.useEffect(() => {
    if (!speculativeUserName || speculativeJoinFiredRef.current) return;
    speculativeJoinFiredRef.current = true;
    speculativeJoinResolvedAtRef.current = null;
    speculativeJoinRef.current = joinMeeting({
      data: { code, displayName: speculativeUserName },
    })
      .then((result) => {
        speculativeJoinResolvedAtRef.current = Date.now();
        if (result?.meetingId && result?.participantId) {
          speculativeOrphanRef.current = {
            meetingId: result.meetingId,
            participantId: result.participantId,
          };
        }
        return result;
      })
      .catch(() => null);
  }, [speculativeUserName, code]);

  // Cleanup the speculative-join row if the user closes the tab or navigates
  // away before clicking Join. Without this, the row stays active forever and
  // gates finalizeSessionIfEmpty for the rest of the meeting's lifecycle.
  React.useEffect(() => {
    const cleanupSpeculative = () => {
      const orphan = speculativeOrphanRef.current;
      if (!orphan) return;
      speculativeOrphanRef.current = null;
      notifyMeetingLeave({ ...orphan, finalizeIfEmpty: true });
    };
    window.addEventListener("pagehide", cleanupSpeculative);
    return () => {
      window.removeEventListener("pagehide", cleanupSpeculative);
      cleanupSpeculative();
    };
  }, []);


  const beginJoinAttempt = React.useCallback(() => {
    joinAttemptIdRef.current += 1;
    return joinAttemptIdRef.current;
  }, []);

  // Core join API call — used by handlePreJoin and by the waiting-room poll.
  const attemptJoin = React.useCallback(
    async (displayName: string, attemptId: number) => {
      const isAuthenticatedJoin = Boolean(sessionData?.user);
      let reconnectParticipantId = loadReconnectParticipantId(code, isAuthenticatedJoin);

      // For authenticated users (no guest reconnect): try the speculative join
      // result first. If it resolved successfully, we can skip the network call.
      let result: Awaited<ReturnType<typeof joinMeeting>> | null = null;
      if (!reconnectParticipantId && speculativeJoinRef.current) {
        const speculative = speculativeJoinRef.current;
        speculativeJoinRef.current = null; // consume — don't reuse across retries
        try {
          result = await speculative;
          if (
            result?.participantId &&
            speculativeJoinResolvedAtRef.current !== null &&
            Date.now() - speculativeJoinResolvedAtRef.current > MAX_SPECULATIVE_CREDENTIAL_AGE_MS
          ) {
            reconnectParticipantId = result.participantId;
            result = null;
          }
        } catch {
          // Speculative failed (e.g. meeting not found) — fall through to normal join
        }
      }

      if (!result) {
        result = await joinMeeting({
          data: { code, displayName, reconnectParticipantId },
        });
      }

      if (!result.token || !result.serverUrl) {
        throw new Error("Failed to get meeting credentials");
      }

      if (joinAttemptIdRef.current !== attemptId) {
        return;
      }

      lastJoinDisplayNameRef.current = result.participantName;
      // Persist guest participant identity across tab closes/restarts.
      persistReconnectParticipantId(
        code,
        result.participantId,
        result.participantIdentity.startsWith("guest_"),
      );

      setJoinResult(result as JoinResult);
      // The speculative row (if any) is now adopted as the live joinResult, so
      // unmount/pagehide cleanup is owned by the joinResult-keyed handlers
      // below; release the orphan tracker.
      speculativeOrphanRef.current = null;
      markMeetingEntryMetric("joinCredentialsReadyAt", { code });
      setPhase("connecting");
    },
    [code, sessionData?.user]
  );

  // Silent poll while waiting for host — retries attemptJoin every 5 s.
  // On success, attemptJoin sets phase to "connecting" and clears waitingForHost.
  const pollJoin = React.useCallback(async () => {
    if (pollJoinInFlightRef.current) return;
    pollJoinInFlightRef.current = true;

    const attemptId = joinAttemptIdRef.current;

    try {
      const displayName = localStorage.getItem("ossmeet.user.name") || "Guest";
      await attemptJoin(displayName, attemptId);
      if (joinAttemptIdRef.current !== attemptId) return;
      setWaitingForHost(false);
    } catch (err) {
      if (joinAttemptIdRef.current !== attemptId) return;
      const errCode = (err as { code?: string })?.code;
      // Stay on pre-join if host still hasn't started; surface other errors
      if (errCode !== "MEETING_NOT_STARTED") {
        logError("Failed to join meeting:", err);
        setWaitingForHost(false);
        setError(err instanceof Error ? err.message : "Failed to join meeting");
        setPhase("error");
      }
    } finally {
      pollJoinInFlightRef.current = false;
    }
  }, [attemptJoin]);

  const handlePreJoin = React.useCallback(
    async (
      videoDeviceId: string | undefined,
      audioDeviceId: string | undefined,
      videoEnabled: boolean,
      audioEnabled: boolean,
      preJoinDisplayName?: string,
      captionLanguage = "en-US"
    ) => {
      const blockReason = getLegacyBrowserBlockReason();
      if (blockReason) {
        setError(blockReason);
        setPhase("error");
        return;
      }

      const attemptId = beginJoinAttempt();
      markMeetingEntryMetric("joinRequestedAt", { code });
      intentionalDisconnectRef.current = false;
      hasConnectedRef.current = false;
      attemptedLegacyFallbackRef.current = false;
      pollJoinInFlightRef.current = false;
      setWaitingForHost(false);
      setShouldConnectRoom(false);
      setUseLegacyPeerConnection(shouldPreferLegacyPeerConnection());
      setPhase("joining");
      setError(null);

      const settings: JoinSettings = {
        videoDeviceId,
        audioDeviceId,
        videoEnabled,
        audioEnabled,
        captionLanguage,
      };
      setJoinSettings(settings);

      try {
        const displayName = preJoinDisplayName || localStorage.getItem("ossmeet.user.name") || "Guest";
        await attemptJoin(displayName, attemptId);
      } catch (err) {
        if (joinAttemptIdRef.current !== attemptId) return;
        logError("Failed to join meeting:", err);
        const errCode = (err as { code?: string })?.code;
        if (errCode === "MEETING_NOT_STARTED") {
          // Stay on pre-join screen — it becomes the waiting room
          setWaitingForHost(true);
          setPhase("prejoin");
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to join meeting";
        setError(message);
        setPhase("error");
      }
    },
    [attemptJoin, beginJoinAttempt]
  );

  // Best-effort cleanup for pre-connect failures: joinMeeting inserts a participant
  // row before WebRTC is proven. If the client errors out before onConnected, mark
  // that participant as left to avoid stale "ghost" attendees.
  React.useEffect(() => {
    if (phase !== "error") return;
    if (hasConnectedRef.current) return;
    if (!joinResult?.meetingId || !joinResult.participantId) return;
    if (failedConnectLeaveIssuedRef.current === joinResult.participantId) return;

    failedConnectLeaveIssuedRef.current = joinResult.participantId;
    void leaveMeeting({
      data: {
        sessionId: joinResult.meetingId,
        participantId: joinResult.participantId,
      },
    }).catch((err) => {
      logWarn("[Meeting] Failed to cleanup participant after connect error:", err);
    });
  }, [phase, joinResult?.meetingId, joinResult?.participantId]);

  const handleRetry = React.useCallback(() => {
    beginJoinAttempt();
    meetingStartTimeRef.current = 0;
    intentionalDisconnectRef.current = false;
    hasConnectedRef.current = false;
    attemptedLegacyFallbackRef.current = false;
    pollJoinInFlightRef.current = false;
    setJoinResult(null);
    setJoinSettings(null);
    setShouldConnectRoom(false);
    setUseLegacyPeerConnection(shouldPreferLegacyPeerConnection());
    setWaitingForHost(false);
    setPhase("prejoin");
    setError(null);
  }, [beginJoinAttempt]);

  const handleJoinResultUpdate = React.useCallback(
    (updates: {
      token: string;
      expiresIn: number;
      turnServers: JoinResult["turnServers"];
      isHost?: boolean;
      whiteboardToken?: string | null;
      whiteboardUrl?: string | null;
    }) => {
      setJoinResult((prev) => prev ? { ...prev, ...updates } : null);
    },
    []
  );

  const handleSessionRefreshFailure = React.useCallback((message: string) => {
    intentionalDisconnectRef.current = true;
    setShouldConnectRoom(false);
    clearReconnectParticipantId(code, Boolean(sessionData?.user));
    setError(message);
    setPhase("error");
  }, [code, sessionData?.user]);

  // Poll every 5 s while waiting for the host to start the room
  React.useEffect(() => {
    if (!waitingForHost) return;
    const id = window.setInterval(pollJoin, WAITING_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [waitingForHost, pollJoin]);

  React.useEffect(() => {
    if (phase !== "connecting" || !shouldConnectRoom) return;

    const timeoutId = window.setTimeout(() => {
      if (hasConnectedRef.current) return;
      setPhase("error");
      setError("Couldn't connect to meeting. Please try again.");
    }, CONNECTING_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [phase, shouldConnectRoom]);

  React.useEffect(() => {
    if (phase !== "connecting" || !joinResult) return;
    setShouldConnectRoom(true);
  }, [phase, joinResult, useLegacyPeerConnection]);

  const roomOptions = React.useMemo<RoomOptions>(
    () => ({
      ...ROOM_OPTIONS,
      singlePeerConnection: !useLegacyPeerConnection,
      publishDefaults: {
        ...ROOM_OPTIONS.publishDefaults,
        videoCodec: resolveCameraCodec(),
        // No backupCodec needed: H.264 is universally supported
      },
      videoCaptureDefaults: {
        ...ROOM_OPTIONS.videoCaptureDefaults,
        deviceId: joinSettings?.videoDeviceId,
      },
      audioCaptureDefaults: {
        ...ROOM_OPTIONS.audioCaptureDefaults,
        deviceId: joinSettings?.audioDeviceId,
      },
    }),
    [joinSettings?.videoDeviceId, joinSettings?.audioDeviceId, useLegacyPeerConnection]
  );

  const roomConnectOptions = React.useMemo<RoomConnectOptions | undefined>(
    () =>
      joinResult?.turnServers && joinResult.turnServers.length > 0
        ? { rtcConfig: sanitizeRtcConfiguration({ iceServers: joinResult.turnServers }) }
        : undefined,
    [joinResult?.turnServers]
  );

  const handleRoomConnected = React.useCallback(() => {
    // Only set once — reconnects should not reset the displayed elapsed time.
    if (meetingStartTimeRef.current === 0) {
      meetingStartTimeRef.current = Date.now();
    }
    attemptedLegacyFallbackRef.current = false;
    autoRejoinAttemptedRef.current = false;
    hasConnectedRef.current = true;
    markMeetingEntryMetric("liveKitConnectedAt", { code });
    setPhase("connected");
    preloadMeetingRoomUi().catch(() => {});
    preloadMeetingWhiteboardModule().catch(() => {});
  }, [code]);

  const handleRoomDisconnected = React.useCallback((reason?: DisconnectReason) => {
    if (intentionalDisconnectRef.current) return;
    if (!hasConnectedRef.current) return;

    const meetingEnded =
      reason === DisconnectReason.ROOM_DELETED ||
      reason === DisconnectReason.ROOM_CLOSED;

    if (meetingEnded && meetingEndedExternallyRef.current) {
      intentionalDisconnectRef.current = true;
      void meetingEndedExternallyRef.current();
      return;
    }

    // First unintentional disconnect after a successful connect: try one
    // automatic rejoin before bothering the user. The server's join handler
    // will mark the prior participant row left, so the cap stays honest.
    if (!autoRejoinAttemptedRef.current) {
      autoRejoinAttemptedRef.current = true;
      const attemptId = beginJoinAttempt();
      hasConnectedRef.current = false;
      setShouldConnectRoom(false);
      setJoinResult(null);
      setError(null);
      setPhase("connecting");
      const displayName =
        lastJoinDisplayNameRef.current ||
        localStorage.getItem("ossmeet.user.name") ||
        authenticatedUser?.name ||
        "Guest";
      void attemptJoin(displayName, attemptId).catch((err) => {
        if (joinAttemptIdRef.current !== attemptId) return;
        logError("[Meeting] Auto-rejoin after disconnect failed:", err);
        setError("Disconnected from meeting. Please rejoin.");
        setPhase("error");
      });
      return;
    }

    setPhase("error");
    setError("Disconnected from meeting. Please rejoin.");
  }, [attemptJoin, authenticatedUser?.name, beginJoinAttempt]);

  const handleRoomError = React.useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (message.includes("client initiated disconnect")) return;

    if (
      !hasConnectedRef.current &&
      !attemptedLegacyFallbackRef.current &&
      !useLegacyPeerConnection &&
      message.includes("could not establish signal connection")
    ) {
      attemptedLegacyFallbackRef.current = true;
      setError(null);
      setPhase("connecting");
      setUseLegacyPeerConnection(true);
      setShouldConnectRoom(false); // force disconnect so the effect reconnects with new options
      logWarn("[Meeting] Signal connect failed; retrying with legacy peer-connection mode");
      return;
    }

    if (!hasConnectedRef.current) {
      setPhase("error");
      setError(
        message.includes("could not establish signal connection")
          ? "Couldn't reach the meeting server. Please try again."
          : "Meeting connection failed. Please try again."
      );
    }
    logError("[Meeting] LiveKit room error:", err);
  }, [useLegacyPeerConnection]);

  if (phase === "prejoin") {
    return (
      <div className="relative w-full" style={{ background: '#f2f0ec' }}>
        <PreJoinScreen
          onJoin={handlePreJoin}
          waitingForHost={waitingForHost}
          noActiveSession={lookup.kind === "permanent" && !lookup.hasActiveSession}
          user={authenticatedUser}
        />
      </div>
    );
  }

  if (phase === "joining") {
    return (
      <div className="relative h-dvh w-full flex items-center justify-center overflow-hidden" style={{ background: '#f2f0ec' }}>
        {/* Single subtle ambient blob */}
        <div className="liquid-blob-teal" style={{ width: 600, height: 600, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0.5 }} />
        
        {/* Clean card */}
        <div className="relative text-center rounded-2xl px-12 py-10 bg-white/90 border border-stone-200 shadow-xl">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-br from-teal-50 to-teal-100 flex items-center justify-center shadow-sm">
            <div className="liquid-spinner-light" style={{ width: 24, height: 24, borderWidth: 2 }} />
          </div>
          <p className="text-stone-700 font-semibold text-base">Joining meeting...</p>
          <p className="text-stone-500 text-sm mt-1.5">Setting up your connection</p>
          <div className="mt-3 flex justify-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="relative flex flex-col items-center justify-center gap-4 overflow-hidden" style={{ height: '100dvh', background: '#f2f0ec' }}>
        {/* Single subtle ambient blob */}
        <div className="liquid-blob-amber" style={{ width: 400, height: 400, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0.5 }} />
        
        {/* Clean card */}
        <div className="relative rounded-2xl px-10 py-8 text-center flex flex-col gap-4 bg-white/90 border border-stone-200 shadow-xl">
          <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-stone-800 font-semibold">{error || "Something went wrong"}</p>
          <button
            onClick={handleRetry}
            className="rounded-xl bg-accent-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-500 transition-colors shadow-lg shadow-accent-600/20"
          >
            Try again
          </button>
          <button
            onClick={() => navigate({ to: "/dashboard" })}
            className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!joinResult || !joinSettings) return null;

  return (
    <LiveKitRoom
      serverUrl={joinResult.serverUrl}
      token={joinResult.token}
      connect={shouldConnectRoom}
      connectOptions={roomConnectOptions}
      options={roomOptions}
      video={joinSettings.videoEnabled}
      audio={joinSettings.audioEnabled}
      onConnected={handleRoomConnected}
      onDisconnected={handleRoomDisconnected}
      onError={handleRoomError}
    >
      <RoomAudioRenderer />
      <ToastProvider>
        <TooltipProvider>
          <MeetingRoomContent
            code={code}
            joinResult={joinResult}
            joinSettings={joinSettings}
            showConnectingOverlay={phase !== "connected"}
            meetingStartTime={meetingStartTimeRef.current}
            isAuthenticated={!!sessionData?.user}
            onIntentionalDisconnect={() => { intentionalDisconnectRef.current = true; }}
            onJoinResultUpdate={handleJoinResultUpdate}
            onSessionRefreshFailure={handleSessionRefreshFailure}
            meetingEndedExternallyRef={meetingEndedExternallyRef}
          />
        </TooltipProvider>
      </ToastProvider>
    </LiveKitRoom>
  );
}

/** Syncs LiveKit room context to parent ref */
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

function MeetingRoomContent({
  code,
  joinResult,
  joinSettings,
  showConnectingOverlay,
  meetingStartTime,
  isAuthenticated,
  onIntentionalDisconnect,
  onJoinResultUpdate,
  onSessionRefreshFailure,
  meetingEndedExternallyRef,
}: {
  code: string;
  joinResult: JoinResult;
  joinSettings: JoinSettings;
  showConnectingOverlay: boolean;
  meetingStartTime: number;
  isAuthenticated: boolean;
  onIntentionalDisconnect: () => void;
  onJoinResultUpdate: (updates: {
    token: string;
    expiresIn: number;
    turnServers: JoinResult["turnServers"];
    isHost?: boolean;
    whiteboardToken?: string | null;
    whiteboardUrl?: string | null;
    recordingActive?: boolean;
    activeEgressId?: string | null;
  }) => void;
  onSessionRefreshFailure: (message: string) => void;
  meetingEndedExternallyRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  const navigate = useNavigate();
  const { add: addToast } = useToast();
  const { isPhone, isTablet, isLandscape, controlBarAutoHide, showVideoSidebar, showParticipantStrip } = useResponsive();
  // Narrow: tablet portrait or phone — whiteboard toolbar renders at bottom in these modes
  const isNarrow = isPhone || (isTablet && !isLandscape);
  const whiteboardRef = React.useRef<MeetingWhiteboardHandle | null>(null);
  const [whiteboardRequests, setWhiteboardRequests] = React.useState<PendingWriteRequest[]>([]);

  // ── Core hooks ──
  const {
    roomInstance,
    mediaScopeRef,
    currentUserId,
    currentUserName,
    connectionQuality,
    handleRoomUpdate,
    disconnectRoomNow,
  } =
    useMeetingLifecycle();

  // Token + TURN auto-refresh.
  // We keep refreshed credentials in app state and use public Room APIs only.
  // If the SDK is already reconnecting, we proactively reconnect with the fresh
  // token via room.connect(...) (idempotent) to avoid stale reconnect attempts.
  React.useEffect(() => {
    if (showConnectingOverlay || !joinResult.expiresIn || !joinResult.meetingId || !joinResult.participantId) return;

    let cancelled = false;
    let timer: number | null = null;
    let transientRetryAttempt = 0;
    let tokenExpiresAt = Date.now() + joinResult.expiresIn * 1000;
    let refreshInFlight: Promise<void> | null = null;

    const runRefresh = async () => {
      if (refreshInFlight) return refreshInFlight;

      refreshInFlight = (async () => {
        try {
          const result = await refreshMeetingToken({
            data: {
              sessionId: joinResult.meetingId,
              participantId: joinResult.participantId,
            },
          });

          if (cancelled) return;

          if (
            roomInstance &&
            (roomInstance.state === ConnectionState.Reconnecting ||
              roomInstance.state === ConnectionState.SignalReconnecting)
          ) {
            await roomInstance.connect(joinResult.serverUrl, result.token).catch((reconnectErr) => {
              logWarn("[Meeting] reconnect with refreshed token failed:", reconnectErr);
            });
          }

          onJoinResultUpdate({
            token: result.token,
            expiresIn: result.expiresIn,
            turnServers: result.turnServers,
            isHost: result.isHost,
            whiteboardToken: result.whiteboardToken,
            whiteboardUrl: result.whiteboardUrl,
            recordingActive: result.recordingActive,
            activeEgressId: result.activeEgressId,
          });

          tokenExpiresAt = Date.now() + result.expiresIn * 1000;
          transientRetryAttempt = 0;
          scheduleRefresh(getMeetingTokenRefreshDelayMs(result.expiresIn));
        } catch (err) {
          if (cancelled) return;

          logError("[Meeting] Token refresh failed:", err);
          const terminalMessage = getMeetingTokenRefreshFailureMessage(err);
          if (terminalMessage) {
            await disconnectRoomNow();
            if (!cancelled) {
              onSessionRefreshFailure(terminalMessage);
            }
            return;
          }

          const retryDelayMs = getMeetingTokenRetryDelayMs(transientRetryAttempt);
          transientRetryAttempt += 1;
          scheduleRefresh(retryDelayMs);
        } finally {
          refreshInFlight = null;
        }
      })();

      return refreshInFlight;
    };

    const scheduleRefresh = (delayMs: number) => {
      timer = window.setTimeout(async () => {
        await runRefresh();
      }, delayMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() < tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) return;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      void runRefresh();
    };

    scheduleRefresh(getMeetingTokenRefreshDelayMs(joinResult.expiresIn));
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    showConnectingOverlay,
    joinResult.expiresIn,
    joinResult.meetingId,
    joinResult.participantId,
    roomInstance,
    onJoinResultUpdate,
    onSessionRefreshFailure,
    disconnectRoomNow,
  ]);

  const {
    whiteboardToken,
    whiteboardWsUrl,
    whiteboardViewState,
    showWhiteboard,
    openWhiteboard,
    closeWhiteboard,
    handleWhiteboardStatusChange,
    handleWhiteboardContentStateChange,
    exportPdfRef,
    exportSnapshotRef,
    exportChoiceRef,
    leavePhase,
    setLeavePhase,
    exportProgress,
    promptAndExport,
    saveWhiteboardPdfArtifact,
  } = useWhiteboardSession(joinResult, roomInstance);
  const handleMeasuredWhiteboardStatusChange = React.useCallback((status: "loading" | "ready" | "error") => {
    handleWhiteboardStatusChange(status);
    if (status === "ready") {
      markMeetingEntryMetric("whiteboardReadyAt", { code });
    }
  }, [code, handleWhiteboardStatusChange]);

  // ── LiveKit connection state ──
  const [hasLocalHostGrant, setHasLocalHostGrant] = React.useState(joinResult.isHost);

  React.useEffect(() => {
    setHasLocalHostGrant(joinResult.isHost);
  }, [joinResult.isHost]);

  React.useEffect(() => {
    if (!roomInstance) {
      setHasLocalHostGrant(joinResult.isHost);
      return;
    }

    const syncLocalHostGrant = () => {
      setHasLocalHostGrant(joinResult.isHost || hasAdminGrant(roomInstance.localParticipant));
    };

    syncLocalHostGrant();
    roomInstance.on(RoomEvent.ParticipantMetadataChanged, syncLocalHostGrant);
    return () => {
      roomInstance.off(RoomEvent.ParticipantMetadataChanged, syncLocalHostGrant);
    };
  }, [joinResult.isHost, roomInstance]);

  const canModerate = hasLocalHostGrant;

  // ── LiveKit hooks ──
  const { participants: presenceParticipants } = useLiveKitPresence(roomInstance);

  const handleSendError = React.useCallback(() => {
    logError("[Meeting] Failed to send message");
  }, []);

  const { messages: chatMessages, sendMessage: sendChatMessage } = useLiveKitChat(
    roomInstance,
    currentUserId,
    currentUserName,
    100,
    handleSendError
  );

  const {
    handRaiseQueue,
    isHandRaised,
    raiseHand,
    lowerHand,
    approveHandRaise,
    dismissHandRaise,
  } = useLiveKitHandRaises(roomInstance, currentUserId, currentUserName, canModerate, handleSendError);

  const handleReaction = React.useCallback((reaction: ReactionEvent) => {
    window.dispatchEvent(new CustomEvent("meetingReaction", { detail: reaction }));
  }, []);

  useLiveKitReactions(roomInstance, handleReaction, currentUserId, currentUserName, handleSendError);

  // ── Screen share permission ──
  const {
    pendingRequests: screenShareRequests,
    requestState: screenShareRequestState,
    requestScreenShare,
    cancelRequest: cancelScreenShareRequest,
    approveRequest: approveScreenShareRequest,
    denyRequest: denyScreenShareRequest,
  } = useLiveKitScreenShare(roomInstance, currentUserId, currentUserName, canModerate);
  const hostPermissionRequests = React.useMemo<HostPermissionRequest[]>(
    () => [
      ...screenShareRequests.map((request) => ({
        kind: "screen-share" as const,
        id: `screen-${request.identity}`,
        userId: request.identity,
        userName: request.userName,
      })),
      ...whiteboardRequests.map((request) => ({
        kind: "whiteboard-write" as const,
        id: `whiteboard-${request.userId}`,
        userId: request.userId,
        userName: request.userName,
      })),
    ],
    [screenShareRequests, whiteboardRequests]
  );
  const [hasScreenSharePermission, setHasScreenSharePermission] = React.useState(() =>
    roomInstance ? hasScreenSharePublishPermission(roomInstance.localParticipant) : false
  );
  const preparedScreenShareTracksRef = React.useRef<LocalTrack[] | null>(null);
  const [hasPreparedScreenShare, setHasPreparedScreenShare] = React.useState(false);
  const [isPreparingScreenShare, setIsPreparingScreenShare] = React.useState(false);
  const [isPublishingPreparedScreenShare, setIsPublishingPreparedScreenShare] = React.useState(false);

  const setPreparedScreenShareTracks = React.useCallback((tracks: LocalTrack[] | null) => {
    preparedScreenShareTracksRef.current = tracks;
    setHasPreparedScreenShare(Boolean(tracks && tracks.length > 0));
  }, []);

  const stopPreparedScreenShareTracks = React.useCallback(() => {
    const tracks = preparedScreenShareTracksRef.current;
    preparedScreenShareTracksRef.current = null;
    setHasPreparedScreenShare(false);
    tracks?.forEach((track) => track.stop());
  }, []);

  const handleCancelScreenShareRequest = React.useCallback(() => {
    stopPreparedScreenShareTracks();
    cancelScreenShareRequest();
  }, [stopPreparedScreenShareTracks, cancelScreenShareRequest]);

  const publishPreparedScreenShareTracks = React.useCallback(async () => {
    if (!roomInstance || isPublishingPreparedScreenShare) return false;
    const tracks = preparedScreenShareTracksRef.current;
    if (!tracks || tracks.length === 0) return false;

    setIsPublishingPreparedScreenShare(true);
    try {
      for (const track of tracks) {
        await roomInstance.localParticipant.publishTrack(
          track,
          track.source === Track.Source.ScreenShare
            ? { videoCodec: resolveScreenShareCodec() }
            : undefined
        );
      }
      setPreparedScreenShareTracks(null);
      cancelScreenShareRequest();
      return true;
    } catch (err) {
      await Promise.allSettled(
        tracks.map((track) => roomInstance.localParticipant.unpublishTrack(track).catch(() => undefined))
      );
      stopPreparedScreenShareTracks();
      cancelScreenShareRequest();
      logError("[Meeting] Failed to publish prepared screen share:", err);
      addToast({
        title: "Screen share failed",
        description: "Could not start sharing your screen. Try again.",
        data: { variant: "error" },
      });
      return false;
    } finally {
      setIsPublishingPreparedScreenShare(false);
    }
  }, [
    roomInstance,
    isPublishingPreparedScreenShare,
    setPreparedScreenShareTracks,
    stopPreparedScreenShareTracks,
    cancelScreenShareRequest,
    addToast,
  ]);

  React.useEffect(() => {
    if (!roomInstance) {
      setHasScreenSharePermission(false);
      return;
    }

    const lp = roomInstance.localParticipant;
    const syncPermission = () => {
      setHasScreenSharePermission(hasScreenSharePublishPermission(lp));
    };
    const handlePermissionsChanged = (_prev: unknown, participant: { identity: string }) => {
      if (participant.identity !== lp.identity) return;
      syncPermission();
    };

    syncPermission();
    roomInstance.on(RoomEvent.ParticipantPermissionsChanged, handlePermissionsChanged);
    return () => {
      roomInstance.off(RoomEvent.ParticipantPermissionsChanged, handlePermissionsChanged);
    };
  }, [roomInstance]);

  React.useEffect(() => {
    return () => {
      stopPreparedScreenShareTracks();
    };
  }, [stopPreparedScreenShareTracks]);

  const handleToggleScreenShare = React.useCallback(async () => {
    if (!roomInstance) return;
    const lp = roomInstance.localParticipant;
    const startSharing = async () => {
      try {
        await lp.setScreenShareEnabled(true, undefined, { videoCodec: resolveScreenShareCodec() });
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") return;
        logError("[Meeting] Screen share error:", err);
      }
    };

    // If already sharing, stop and revoke the grant so the next share requires a new approval
    if (lp.isScreenShareEnabled) {
      try {
        await lp.setScreenShareEnabled(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") return;
        logError("[Meeting] Screen share error:", err);
      }
      stopPreparedScreenShareTracks();
      cancelScreenShareRequest();
      // Non-host: revoke the server-side grant so approval is not sticky
      if (!canModerate) {
        grantScreenShare({
          data: { meetingId: joinResult.meetingId, targetIdentity: joinResult.participantIdentity, allow: false },
        }).catch((err) => logError("[Meeting] Failed to revoke screen share permission:", err));
      }
      return;
    }

    // Host can share directly
    if (canModerate) {
      await startSharing();
      return;
    }

    if (hasScreenSharePermission) {
      if (preparedScreenShareTracksRef.current) {
        await publishPreparedScreenShareTracks();
        return;
      }
      cancelScreenShareRequest();
      await startSharing();
      return;
    }

    if (
      isPreparingScreenShare ||
      isPublishingPreparedScreenShare ||
      screenShareRequestState === "pending" ||
      screenShareRequestState === "approved" ||
      hasPreparedScreenShare
    ) {
      return;
    }

    setIsPreparingScreenShare(true);
    try {
      const tracks = await lp.createScreenTracks();
      if (tracks.length === 0) return;
      setPreparedScreenShareTracks(tracks);
      requestScreenShare();
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") return;
      logError("[Meeting] Screen share capture error:", err);
      addToast({
        title: "Screen share failed",
        description: "Could not capture your screen. Try again.",
        data: { variant: "error" },
      });
    } finally {
      setIsPreparingScreenShare(false);
    }
  }, [
    roomInstance,
    canModerate,
    hasScreenSharePermission,
    hasPreparedScreenShare,
    isPreparingScreenShare,
    isPublishingPreparedScreenShare,
    screenShareRequestState,
    requestScreenShare,
    publishPreparedScreenShareTracks,
    setPreparedScreenShareTracks,
    stopPreparedScreenShareTracks,
    cancelScreenShareRequest,
    addToast,
    joinResult.meetingId,
    joinResult.participantIdentity,
  ]);

  React.useEffect(() => {
    if (
      screenShareRequestState !== "approved" ||
      canModerate ||
      hasScreenSharePermission ||
      !hasPreparedScreenShare
    ) {
      return;
    }
    const timer = setTimeout(() => {
      logError("[Meeting] Screen share permission update timed out");
      handleCancelScreenShareRequest();
      addToast({
        title: "Screen share approval timed out",
        description: "The grant did not reach your browser. Request screen share again.",
        data: { variant: "error" },
      });
    }, 10_000);
    return () => clearTimeout(timer);
  }, [
    screenShareRequestState,
    canModerate,
    hasScreenSharePermission,
    hasPreparedScreenShare,
    handleCancelScreenShareRequest,
    addToast,
  ]);

  React.useEffect(() => {
    if (
      screenShareRequestState !== "approved" ||
      canModerate ||
      !hasScreenSharePermission ||
      !hasPreparedScreenShare
    ) {
      return;
    }
    void publishPreparedScreenShareTracks();
  }, [
    screenShareRequestState,
    canModerate,
    hasScreenSharePermission,
    hasPreparedScreenShare,
    publishPreparedScreenShareTracks,
  ]);

  // Auto-dismiss denied state after 3 seconds
  React.useEffect(() => {
    if (screenShareRequestState !== "denied") return;
    stopPreparedScreenShareTracks();
    const timer = setTimeout(() => cancelScreenShareRequest(), 3000);
    return () => clearTimeout(timer);
  }, [screenShareRequestState, stopPreparedScreenShareTracks, cancelScreenShareRequest]);

  // When host approves a request, call server to grant permission
  const handleApproveScreenShare = React.useCallback(
    async (targetIdentity: string) => {
      try {
        await grantScreenShare({
          data: { meetingId: joinResult.meetingId, targetIdentity, allow: true },
        });
        approveScreenShareRequest(targetIdentity);
      } catch (err) {
        logError("[Meeting] Failed to grant screen share:", err);
        denyScreenShareRequest(targetIdentity);
      }
    },
    [approveScreenShareRequest, denyScreenShareRequest, joinResult.meetingId]
  );

  const handleDenyScreenShare = React.useCallback(
    async (targetIdentity: string) => {
      denyScreenShareRequest(targetIdentity);
      try {
        await grantScreenShare({
          data: { meetingId: joinResult.meetingId, targetIdentity, allow: false },
        });
      } catch (err) {
        logError("[Meeting] Failed to revoke screen share:", err);
      }
    },
    [denyScreenShareRequest, joinResult.meetingId]
  );

  const handleApproveWhiteboard = React.useCallback(async (userId: string) => {
    try {
      await approveWhiteboardWrite({
        data: {
          meetingId: joinResult.meetingId,
          targetUserId: userId,
          participantId: joinResult.participantId,
        },
      });
      setWhiteboardRequests((prev) => prev.filter((request) => request.userId !== userId));
      whiteboardRef.current?.clearPendingRequest(userId);
    } catch (err) {
      logError("[Meeting] Failed to approve whiteboard writer:", err);
      addToast({
        title: "Approval failed",
        description: "Could not approve whiteboard access. Please try again.",
        data: { variant: "error" },
      });
    }
  }, [addToast, joinResult.meetingId, joinResult.participantId]);

  const handleDenyWhiteboard = React.useCallback(async (userId: string) => {
    try {
      await denyWhiteboardWrite({
        data: {
          meetingId: joinResult.meetingId,
          targetUserId: userId,
          participantId: joinResult.participantId,
        },
      });
      setWhiteboardRequests((prev) => prev.filter((request) => request.userId !== userId));
      whiteboardRef.current?.clearPendingRequest(userId);
    } catch (err) {
      logError("[Meeting] Failed to deny whiteboard writer:", err);
      addToast({
        title: "Action failed",
        description: "Could not deny whiteboard access. Please try again.",
        data: { variant: "error" },
      });
    }
  }, [addToast, joinResult.meetingId, joinResult.participantId]);

  React.useEffect(() => {
    if (!showWhiteboard) {
      setWhiteboardRequests([]);
    }
  }, [showWhiteboard]);

  // ── Captions & transcript buffering ──
  const [showCaptions, setShowCaptions] = React.useState(false);
  const [showCaptionLanguagePicker, setShowCaptionLanguagePicker] = React.useState(false);
  const [captionCountry, setCaptionCountry] = React.useState<string | null>(null);
  const [captionLanguage, setCaptionLanguage] = React.useState(joinSettings.captionLanguage);

  // Transcript buffer: accumulates isFinal segments → flushed to D1 on leave.
  // Silently no-ops for guests (server rejects unauthenticated saves).
  const { addSegment, addRemoteSegment, flush: flushTranscripts } = useTranscriptBuffer({
    meetingId: joinResult.meetingId,
    participantIdentity: currentUserId || joinResult.participantIdentity,
    participantName: currentUserName || joinResult.participantName,
  });

  const { captions, captionHistory, sendCaption, sendUntranscribable } =
    useLiveKitCaptions(
      roomInstance,
      currentUserId,
      currentUserName,
      true, // updated below via speechSupported
      addRemoteSegment
    );

  // Speech recognition: always runs when mic is on (both captions + notes).
  // Uses the browser's navigator.language as the primary language hint.
  const { isSupported: speechSupported, start: startSpeech, stop: stopSpeech } =
    useSpeechRecognition({
      lang: captionLanguage,
      onTranscript: React.useCallback(
        (text: string, isFinal: boolean, meta: SpeechTranscriptMeta) => {
          const accepted = sendCaption(text, isFinal, meta);
          if (accepted && isFinal) addSegment(text, meta);
        },
        [sendCaption, addSegment]
      ),
    });

  const handleToggleCaptions = React.useCallback(() => {
    setShowCaptions((prev) => !prev);
  }, []);

  React.useEffect(() => {
    saveSpeechLanguage(captionLanguage);
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
  const hasScreenShare = useTracks([Track.Source.ScreenShare], {
    onlySubscribed: true,
  }).length > 0;

  const liveKitConnectionState = useConnectionState();
  const isLiveKitConnecting = liveKitConnectionState === ConnectionState.Connecting;
  const isLiveKitReconnecting =
    liveKitConnectionState === ConnectionState.Reconnecting ||
    liveKitConnectionState === ConnectionState.SignalReconnecting;
  const connectionOverlayLabel = isLiveKitReconnecting
    ? "Reconnecting meeting..."
    : "Joining meeting...";
  const { localParticipant } = useLocalParticipant();
  const isMicOn = localParticipant.isMicrophoneEnabled;
  const isCameraOn = localParticipant.isCameraEnabled;
  const isScreenSharing = localParticipant.isScreenShareEnabled;

  // Start/stop speech recognition based on mic state
  React.useEffect(() => {
    if (!speechSupported) return;
    if (isMicOn) {
      startSpeech();
    } else {
      stopSpeech();
    }
  }, [isMicOn, speechSupported, startSpeech, stopSpeech]);

  // When the browser doesn't support Web Speech API, signal to other participants
  // that the user is speaking but captions aren't available
  React.useEffect(() => {
    if (speechSupported || !isMicOn) return;
    const lp = roomInstance?.localParticipant;
    if (!lp?.isSpeaking) return;
    sendUntranscribable();
  }, [speechSupported, isMicOn, roomInstance, sendUntranscribable]);

  // ── UI state ──
  const ui = useMeetingUI({
    chatMessages,
    currentUserId,
    roomInstance,
    controlBarAutoHide,
    canModerate,
    isHandRaised,
    raiseHand,
    lowerHand,
    whiteboardWsUrl,
    whiteboardToken,
  });

  // ── Recording ──
  const [isRecording, setIsRecording] = React.useState(joinResult.recordingActive ?? false);
  const [egressId, setEgressId] = React.useState<string | null>(joinResult.activeEgressId ?? null);
  const [recordingRequestPending, setRecordingRequestPending] = React.useState(false);
  const recordingPending = recordingRequestPending;

  React.useEffect(() => {
    setIsRecording(joinResult.recordingActive ?? false);
    setEgressId(joinResult.activeEgressId ?? null);
  }, [joinResult.activeEgressId, joinResult.recordingActive]);

  // Sync recording state from room metadata so all participants (including
  // non-hosts) see live updates when the host starts or stops a recording.
  React.useEffect(() => {
    if (!roomInstance) return;
    const handleMetadataChanged = (metadata: string | undefined) => {
      if (!metadata) return;
      try {
        const parsed = JSON.parse(metadata) as { recordingActive?: boolean };
        if (typeof parsed.recordingActive === "boolean") {
          setIsRecording(parsed.recordingActive);
        }
      } catch {
        // Ignore non-JSON or unrelated metadata
      }
    };
    roomInstance.on(RoomEvent.RoomMetadataChanged, handleMetadataChanged);
    return () => {
      roomInstance.off(RoomEvent.RoomMetadataChanged, handleMetadataChanged);
    };
  }, [roomInstance]);

  const handleToggleRecording = React.useCallback(async () => {
    if (recordingRequestPending) return;
    setRecordingRequestPending(true);
    const action = isRecording ? "stop" : "start";
    try {
      const result = await toggleRecording({
        data: {
          sessionId: joinResult.meetingId,
          action,
          egressId: egressId ?? undefined,
        },
      });
      const recordingNowActive = result.status === "recording";
      setIsRecording(recordingNowActive);
      setEgressId(result.egressId);
      addToast({
        title: recordingNowActive ? "Recording in progress" : "Recording stopped",
        description: recordingNowActive
          ? "This meeting is being recorded."
          : "Recording has been saved.",
        data: { variant: recordingNowActive ? "success" : "info" },
      });
    } catch (err) {
      logError("[Meeting] Recording toggle failed:", err);
      addToast({
        title: action === "start" ? "Recording failed" : "Could not stop recording",
        description: getErrorMessage(err),
        data: { variant: "error" },
      });
    } finally {
      setRecordingRequestPending(false);
    }
  }, [addToast, egressId, isRecording, joinResult.meetingId, recordingRequestPending]);

  // Register handler for when the host ends the meeting while we're in it.
  // Keeps the whiteboard mounted so the export prompt can run.
  React.useEffect(() => {
    meetingEndedExternallyRef.current = async () => {
      await flushTranscripts().catch(() => {});
      clearReconnectParticipantId(code, isAuthenticated);
      const recapPath = `/dashboard/${code}`;
      navigate(
        isAuthenticated
          ? { to: "/dashboard/$code", params: { code } }
          : { to: "/auth", search: { mode: "login", redirect: recapPath } }
      );
    };
    return () => {
      meetingEndedExternallyRef.current = null;
    };
  }, [meetingEndedExternallyRef, flushTranscripts, code, isAuthenticated, navigate]);

  // ── Leave / End ──
  const handleLeave = React.useCallback(async () => {
    onIntentionalDisconnect();
    await promptAndExport();
    // Flush any remaining transcript segments before leaving
    await flushTranscripts().catch(() => {});
    await disconnectRoomNow();
    try {
      await leaveMeeting({
        data: {
          sessionId: joinResult.meetingId,
          participantId: joinResult.participantId,
          // guestSecret read from HttpOnly cookie server-side
        },
      });
    } catch (err) {
      logError("[Meeting] Failed to leave:", err);
    }
    clearReconnectParticipantId(code, isAuthenticated);
    const recapPath = `/dashboard/${code}`;
    navigate(
      isAuthenticated
        ? { to: "/dashboard/$code", params: { code } }
        : { to: "/auth", search: { mode: "login", redirect: recapPath } }
    );
  }, [
    joinResult.meetingId,
    joinResult.participantId,
    isAuthenticated,
    navigate,
    onIntentionalDisconnect,
    promptAndExport,
    flushTranscripts,
    disconnectRoomNow,
    code,
  ]);

  const [showEndConfirm, setShowEndConfirm] = React.useState(false);

  const handleEnd = React.useCallback(async () => {
    setShowEndConfirm(true);
  }, []);

  const confirmLeave = React.useCallback(async () => {
    setShowEndConfirm(false);
    await handleLeave();
  }, [handleLeave]);

  const confirmEnd = React.useCallback(async () => {
    setShowEndConfirm(false);
    onIntentionalDisconnect();
    try {
      await saveWhiteboardPdfArtifact();
    } catch (err) {
      logError("[Meeting] Failed to save whiteboard PDF before ending:", err);
      addToast({
        title: "Whiteboard PDF was not saved",
        description: "The meeting will end, but the dashboard PDF may be unavailable.",
        data: { variant: "error" },
      });
    }
    // Flush any remaining transcript segments before ending
    await flushTranscripts().catch(() => {});
    try {
      await endMeeting({ data: { sessionId: joinResult.meetingId } });
    } catch (err) {
      logError("[Meeting] Failed to end:", err);
      addToast({
        title: "Could not end meeting",
        description: "Please try again.",
        data: { variant: "error" },
      });
      return;
    }
    await disconnectRoomNow();
    clearReconnectParticipantId(code, isAuthenticated);
    navigate(
      isAuthenticated
        ? { to: "/dashboard/$code", params: { code } }
        : { to: "/dashboard" }
    );
  }, [
    addToast,
    endMeeting,
    joinResult.meetingId,
    isAuthenticated,
    navigate,
    onIntentionalDisconnect,
    saveWhiteboardPdfArtifact,
    flushTranscripts,
    disconnectRoomNow,
    code,
  ]);

  // Best-effort server-side leave when tab is closed or navigated away.
  // Normal in-app leave/end flows already call leaveMeeting/endMeeting explicitly.
  React.useEffect(() => {
    const handlePageHide = () => {
      notifyMeetingLeave({
        meetingId: joinResult.meetingId,
        participantId: joinResult.participantId,
      });
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [joinResult.meetingId, joinResult.participantId]);

  // ── Audio cancellation ──
  const {
    canToggleNoiseFilter,
    setNoiseFilterEnabled,
    isNoiseFilterEnabled,
    isNoiseFilterPending,
  } = useAudioCancellation(roomInstance, isMicOn);

  // ── Background effect ──
  const bgEffect = useBackgroundEffect(roomInstance);

  React.useEffect(() => {
    if (!bgEffect.lastError) return;
    addToast({
      title: "Background effect failed",
      description: bgEffect.lastError,
      data: { variant: "error" },
    });
  }, [bgEffect.lastError, addToast]);

  // ── Camera device switching ──
  const [videoDevices, setVideoDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [currentVideoDeviceId, setCurrentVideoDeviceId] = React.useState<string | undefined>(undefined);

  // Enumerate video devices on mount and when requested
  const refreshVideoDevices = React.useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();

      // Log all devices for debugging (groupId helps identify related virtual devices)
      if (process.env.NODE_ENV === "development") {
        console.log("[Camera] All media devices:", devices.map(d => ({
          kind: d.kind,
          label: d.label,
          deviceId: d.deviceId.slice(0, 8) + "...",
          groupId: d.groupId?.slice(0, 8) + "...",
        })));
      }

      // Get all video input devices
      const videoInputs = devices.filter((d) => d.kind === "videoinput");

      // On macOS, Continuity Camera and virtual cameras may appear with the same groupId
      // but different deviceIds - ensure we keep all of them
      const uniqueDevices = videoInputs.filter((device, index, self) =>
        // Keep device if it's the first occurrence of this deviceId
        index === self.findIndex((d) => d.deviceId === device.deviceId)
      );

      // Check for devices with empty labels (permission not granted yet)
      const emptyLabelCount = uniqueDevices.filter(d => !d.label).length;
      if (emptyLabelCount > 0 && process.env.NODE_ENV === "development") {
        console.log(`[Camera] ${emptyLabelCount} device(s) have empty labels - permission may not be granted yet`);
      }

      setVideoDevices(uniqueDevices);

      // Update current device if not set
      if (!currentVideoDeviceId && uniqueDevices.length > 0) {
        setCurrentVideoDeviceId(uniqueDevices[0].deviceId);
      }
    } catch (err) {
      logError("[Meeting] Failed to enumerate video devices:", err);
    }
  }, [currentVideoDeviceId]);

  // Initial device enumeration
  React.useEffect(() => {
    refreshVideoDevices();
  }, [refreshVideoDevices]);

  // Listen for device changes (e.g., USB camera connected/disconnected)
  React.useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => {
      refreshVideoDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshVideoDevices]);

  // Refresh devices when camera is turned on - this can reveal devices that
  // weren't visible before permission was granted
  React.useEffect(() => {
    if (isCameraOn) {
      // Small delay to allow the browser to register the new permission state
      const timeout = setTimeout(() => {
        refreshVideoDevices();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [isCameraOn, refreshVideoDevices]);

  // Handle camera device switching
  const handleSelectVideoDevice = React.useCallback(async (deviceId: string) => {
    if (!roomInstance) return;
    try {
      await roomInstance.switchActiveDevice("videoinput", deviceId, true);
      setCurrentVideoDeviceId(deviceId);
    } catch (err) {
      logError("[Meeting] Failed to switch camera:", err);
      addToast({
        title: "Camera switch failed",
        description: "Could not switch to the selected camera. Please try again.",
        data: { variant: "error" },
      });
    }
  }, [roomInstance, addToast]);

  // ── Derived ──
  const participantsList = React.useMemo(
    () =>
      presenceParticipants.map((p) => ({
        id: p.identity,
        name: p.userName,
        role: p.role,
      })),
    [presenceParticipants]
  );

  const whiteboardRequested = showWhiteboard;
  const whiteboardCanMount = showWhiteboard && !!whiteboardToken && !!whiteboardWsUrl;
  const whiteboardReady = whiteboardRequested && whiteboardViewState === "ready";
  const whiteboardLoading = whiteboardRequested && whiteboardViewState === "loading";
  const whiteboardError = whiteboardRequested && whiteboardViewState === "error";
  const whiteboardDisabledByConfig = whiteboardRequested && !joinResult.whiteboardEnabled;
  const showScreenShareStage = hasScreenShare;
  const showWhiteboardCanvas = whiteboardReady && !showScreenShareStage;
  const showBottomRequestTray = canModerate && hostPermissionRequests.length > 0 && whiteboardRequested;
  const desktopPanelRightOffsetClass = showVideoSidebar
    ? "right-[calc(200px+0.75rem)] lg:right-[calc(240px+0.75rem)]"
    : "right-3";
  const handleAddWikiImageToWhiteboard = React.useCallback(async (imageUrl: string) => {
    if (!whiteboardRef.current) {
      throw new Error("Open the whiteboard first");
    }
    await whiteboardRef.current.importExternalImage(imageUrl);
  }, []);

  const [isSyncingWhiteboard, setIsSyncingWhiteboard] = React.useState(false);
  const handleSyncWhiteboard = React.useCallback(async () => {
    if (!whiteboardRef.current || isSyncingWhiteboard) return;
    setIsSyncingWhiteboard(true);
    try {
      const ok = await whiteboardRef.current.syncCurrentPage();
      if (!ok) {
        addToast({
          title: "Nothing to sync yet",
          description: "Open a page in the whiteboard first, then press Sync.",
          data: { variant: "info" },
        });
      }
    } catch (err) {
      logError("[Meeting] Whiteboard sync failed:", err);
      addToast({
        title: "Sync failed",
        description: "Could not broadcast your whiteboard page. Try again.",
        data: { variant: "error" },
      });
    } finally {
      setIsSyncingWhiteboard(false);
    }
  }, [isSyncingWhiteboard, addToast]);

  return (
    <div ref={mediaScopeRef} className="relative h-dvh overflow-hidden liquid-meeting-bg">
      <RoomRefTracker onRoom={handleRoomUpdate} />

      {/* Connecting overlay — luminous light theme */}
      {(showConnectingOverlay || isLiveKitConnecting || isLiveKitReconnecting) && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(245, 244, 242, 0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
          <div className="liquid-glass-glow text-center rounded-3xl px-12 py-9">
            <div className="liquid-spinner-light mx-auto mb-4" />
            <p className="text-stone-600 font-medium">{connectionOverlayLabel}</p>
          </div>
        </div>
      )}

      <SuspenseBoundary>
        <LazyEndMeetingDialog
          show={showEndConfirm}
          onCancel={() => setShowEndConfirm(false)}
          onLeave={canModerate ? confirmLeave : undefined}
          onConfirm={confirmEnd}
        />
      </SuspenseBoundary>

      <SuspenseBoundary>
        <LazyLeavePdfDialog
          leavePhase={leavePhase}
          exportChoiceRef={exportChoiceRef}
          exportProgress={exportProgress}
          onSkip={() => { setLeavePhase(null); exportChoiceRef.current?.(false); }}
        />
      </SuspenseBoundary>

      {/* ── Primary content (Zero-Chrome on mobile) ── */}
      <div className={cn(
        "absolute inset-0 overflow-hidden transition-all duration-500",
        !isPhone && "top-11"
      )}>
        {whiteboardRequested ? (
          <>
            {showWhiteboardCanvas ? null : showScreenShareStage ? (
              <div className="flex h-full">
                <div className="flex-1 min-h-0">
                  <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                    <LazyModernScreenShareStage />
                  </SuspenseBoundary>
                </div>
                {showVideoSidebar && (
                  <div className="w-[200px] lg:w-[240px] shrink-0 flex-col h-full flex bg-white border-l border-stone-200 shadow-[-4px_0_24px_-4px_rgba(0,0,0,0.08)]">
                    <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                      <LazyModernVideoSidebar
                        presence={presenceParticipants}
                        includeScreenShare={false}
                        videoDevices={videoDevices}
                        currentVideoDeviceId={currentVideoDeviceId}
                        onSelectVideoDevice={handleSelectVideoDevice}
                        onRefreshVideoDevices={refreshVideoDevices}
                      />
                    </SuspenseBoundary>
                  </div>
                )}
              </div>
            ) : (
              <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                <LazyModernVideoGrid
                  presence={presenceParticipants}
                  videoDevices={videoDevices}
                  currentVideoDeviceId={currentVideoDeviceId}
                  onSelectVideoDevice={handleSelectVideoDevice}
                  onRefreshVideoDevices={refreshVideoDevices}
                />
              </SuspenseBoundary>
            )}

            <div
              className={cn(
                "absolute inset-0 flex h-full transition-opacity duration-500 ease-out",
                showWhiteboardCanvas ? "opacity-100" : "pointer-events-none opacity-0"
              )}
            >
              <div
                className={cn(
                  "relative z-10 min-h-0 min-w-0 flex-1 overflow-hidden",
                  isPhone && "w-full"
                )}
                style={{
                  background: "#f2f0ec",
                  paddingTop: showParticipantStrip
                    ? `calc(env(safe-area-inset-top, 0px) + 120px)`
                    : undefined,
                  paddingBottom: isNarrow
                    ? "calc(env(safe-area-inset-bottom, 0px) + 144px)"
                    : "env(safe-area-inset-bottom, 0px)",
                }}
              >
                {/* Whiteboard Canvas with skeleton loading state */}
                {whiteboardCanMount ? (
                  <React.Suspense fallback={
                    <div className="w-full h-full flex items-center justify-center" style={{ background: "#f2f0ec" }}>
                      <div className="text-center">
                        <div style={{
                          width: 48,
                          height: 48,
                          borderRadius: 12,
                          background: "linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          margin: "0 auto 12px",
                          boxShadow: "0 4px 12px -2px rgba(20,184,166,0.15)",
                        }}>
                          <div className="liquid-spinner-light" />
                        </div>
                        <p className="text-stone-500 text-sm font-medium">Preparing canvas...</p>
                      </div>
                    </div>
                  }>
                    <div className={cn(
                      "w-full h-full transition-opacity duration-700",
                      whiteboardReady ? "opacity-100" : "opacity-0"
                    )} style={{ background: "#f2f0ec" }}>
                      <LazyMeetingWhiteboard
                        ref={whiteboardRef}
                        whiteboardUrl={whiteboardWsUrl}
                        token={whiteboardToken}
                        meetingId={joinResult.meetingId}
                        participantId={joinResult.participantId}
                        isHost={canModerate}
                        onExportReady={(fn) => { exportPdfRef.current = fn; }}
                        onSnapshotReady={(fn) => { exportSnapshotRef.current = fn; }}
                        onStatusChange={handleMeasuredWhiteboardStatusChange}
                        onContentStateChange={handleWhiteboardContentStateChange}
                        aiEnabled
                        aiApiUrl="/api/ai/assistant"
                        onCustomMessage={ui.handleWhiteboardCustomMessage}
                        onPendingRequestsChange={setWhiteboardRequests}
                      />
                    </div>
                  </React.Suspense>
                ) : null}
                {!isPhone && ui.showSearch && (
                  <div className="absolute right-3 top-3 z-30">
                    <SuspenseBoundary>
                      <LazyWikiSearchPanel
                        onClose={() => ui.setShowSearch(false)}
                        triggerQuery={ui.wikiQuery}
                        userName={currentUserName}
                        onAddImageToWhiteboard={
                          whiteboardReady ? handleAddWikiImageToWhiteboard : undefined
                        }
                        onBroadcastSearch={ui.handleWikiBroadcast}
                        remoteSearch={ui.remoteWikiSearch}
                      />
                    </SuspenseBoundary>
                  </div>
              )}
            </div>
              {showVideoSidebar && (
                <div className="relative flex h-full w-[200px] shrink-0 flex-col bg-white border-l border-stone-200 shadow-[-4px_0_24px_-4px_rgba(0,0,0,0.08)] lg:w-[240px]">
                  <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                    <LazyModernVideoSidebar
                      presence={presenceParticipants}
                      includeScreenShare={false}
                      videoDevices={videoDevices}
                      currentVideoDeviceId={currentVideoDeviceId}
                      onSelectVideoDevice={handleSelectVideoDevice}
                      onRefreshVideoDevices={refreshVideoDevices}
                    />
                  </SuspenseBoundary>
                </div>
              )}
            </div>

            {!showScreenShareStage && (whiteboardLoading || whiteboardError || whiteboardDisabledByConfig) && (
              <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: "rgba(245, 244, 242, 0.95)", backdropFilter: "blur(24px)" }}>
                <div className="liquid-glass-soft mx-6 w-full max-w-sm rounded-3xl p-8 text-center">
                  {whiteboardDisabledByConfig ? (
                    <>
                      <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
                        <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
                        </svg>
                      </div>
                      <p className="text-base font-semibold text-stone-800">Whiteboard unavailable</p>
                      <p className="mt-2 text-sm text-stone-500">
                        {joinResult.whiteboardDisabledReason || "Continuing without the shared canvas."}
                      </p>
                      <button
                        onClick={() => { void closeWhiteboard(); }}
                        className="mt-5 rounded-xl px-5 py-2.5 text-sm font-medium text-stone-700 transition-all hover:bg-stone-200 bg-stone-100"
                      >
                        Continue meeting
                      </button>
                    </>
                  ) : whiteboardError ? (
                    <>
                      <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                        <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                      <p className="text-base font-semibold text-stone-800">Canvas unavailable</p>
                      <p className="mt-2 text-sm text-stone-500">
                        Continuing without the shared canvas.
                      </p>
                      <button
                        onClick={() => { void closeWhiteboard(); }}
                        className="mt-5 rounded-xl px-5 py-2.5 text-sm font-medium text-stone-700 transition-all hover:bg-stone-200 bg-stone-100"
                      >
                        Continue meeting
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-teal-50 to-teal-100 flex items-center justify-center shadow-sm">
                        <div className="liquid-spinner-light" />
                      </div>
                      <p className="text-base font-semibold text-stone-800">Preparing canvas...</p>
                      <p className="mt-2 text-sm text-stone-500">
                        Setting up your shared workspace
                      </p>
                      <div className="mt-4 flex justify-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        ) : hasScreenShare ? (
          <div className="flex h-full">
            <div className="flex-1 min-h-0">
              <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                <LazyModernScreenShareStage />
              </SuspenseBoundary>
            </div>
            {showVideoSidebar && (
              <div className="relative flex h-full w-[200px] shrink-0 flex-col bg-[#f8f4ee]/92 backdrop-blur-xl border-l border-stone-200/80 lg:w-[240px]">
                <SuspenseBoundary fallback={<div className="h-full w-full" />}>
                  <LazyModernVideoSidebar
                    presence={presenceParticipants}
                    includeScreenShare={false}
                    videoDevices={videoDevices}
                    currentVideoDeviceId={currentVideoDeviceId}
                    onSelectVideoDevice={handleSelectVideoDevice}
                    onRefreshVideoDevices={refreshVideoDevices}
                  />
                </SuspenseBoundary>
              </div>
            )}
          </div>
        ) : (
          <SuspenseBoundary fallback={<div className="h-full w-full" />}>
            <LazyModernVideoGrid
              presence={presenceParticipants}
              videoDevices={videoDevices}
              currentVideoDeviceId={currentVideoDeviceId}
              onSelectVideoDevice={handleSelectVideoDevice}
              onRefreshVideoDevices={refreshVideoDevices}
            />
          </SuspenseBoundary>
        )}
      </div>

      {/* ── Participant strip ── */}
      {showParticipantStrip && (isPhone || showWhiteboard) && !(isPhone && hasScreenShare) && (
        <SuspenseBoundary>
          <LazyModernMobileParticipantStrip
            videoDevices={videoDevices}
            currentVideoDeviceId={currentVideoDeviceId}
            onSelectVideoDevice={handleSelectVideoDevice}
            onRefreshVideoDevices={refreshVideoDevices}
          />
        </SuspenseBoundary>
      )}

      {/* ── Quantum Mobile UI (phone only) ── */}
      {isPhone && (
        <SuspenseBoundary>
          <LazyQuantumActionPill
            isMicOn={isMicOn}
            isCameraOn={isCameraOn}
            isScreenSharing={isScreenSharing}
            showWhiteboard={showWhiteboard}
            showChat={ui.showChat}
            showParticipants={ui.showParticipants}
            unreadCount={ui.chatUnreadCount}
            onToggleMic={() => {
              const lp = roomInstance?.localParticipant;
              lp?.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
            }}
            onToggleCamera={() => {
              const lp = roomInstance?.localParticipant;
              lp?.setCameraEnabled(!lp.isCameraEnabled);
            }}
            onToggleScreenShare={handleToggleScreenShare}
            onToggleWhiteboard={async () => {
              if (showWhiteboard) {
                void closeWhiteboard();
                return;
              }
              await openWhiteboard();
            }}
            onToggleChat={ui.handleToggleChat}
            onToggleParticipants={ui.handleToggleParticipants}
            onOpenCaptionLanguage={speechSupported ? () => setShowCaptionLanguagePicker(true) : undefined}
            backgroundMode={bgEffect.mode}
            backgroundImagePath={bgEffect.imagePath}
            backgroundSupported={bgEffect.isSupported}
            backgroundProcessing={bgEffect.isProcessing}
            onBackgroundNone={bgEffect.clearEffect}
            onBackgroundBlur={bgEffect.setBlur}
            onBackgroundImage={bgEffect.setImage}
            onLeave={canModerate ? handleEnd : handleLeave}
          />
        </SuspenseBoundary>
      )}

      {/* ── Desktop control bar ── */}
      {!isPhone && (
        <div className={cn("absolute inset-x-0 top-0 z-[110] transition-opacity duration-300", !ui.controlsVisible && "pointer-events-none opacity-0")}>
          <SuspenseBoundary>
            <LazyTopControlBar
              code={code}
              meetingStartTime={meetingStartTime}
              participantCount={presenceParticipants.length}
              connectionQuality={connectionQuality}
              isMicOn={isMicOn}
              isCameraOn={isCameraOn}
              isScreenSharing={isScreenSharing}
              isRecording={isRecording}
              recordingPending={recordingPending}
              showWhiteboard={showWhiteboard}
              showChat={ui.showChat}
              showParticipants={ui.showParticipants}
              unreadCount={ui.chatUnreadCount}
              isHandRaised={isHandRaised}
              whiteboardDisabled={!joinResult?.whiteboardEnabled}
              whiteboardDisabledReason={joinResult?.whiteboardDisabledReason}
              recordingDisabled={!joinResult?.recordingEnabled || !canModerate || recordingPending}
              onToggleMic={() => {
                const lp = roomInstance?.localParticipant;
                lp?.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
              }}
              onToggleCamera={() => {
                const lp = roomInstance?.localParticipant;
                lp?.setCameraEnabled(!lp.isCameraEnabled);
              }}
              onToggleScreenShare={handleToggleScreenShare}
              onToggleRecording={handleToggleRecording}
              showRecordingControl={canModerate}
              onToggleWhiteboard={async () => {
                if (!showWhiteboard) {
                  await openWhiteboard();
                  return;
                }
                await closeWhiteboard({ saveSnapshot: true });
              }}
              onSyncWhiteboard={canModerate ? handleSyncWhiteboard : undefined}
              isSyncingWhiteboard={isSyncingWhiteboard}
              showCaptions={showCaptions}
              onToggleCaptions={handleToggleCaptions}
              captionLanguageTag={captionLanguage}
              captionLanguageLabel={captionLanguageLabel}
              captionCountry={captionCountry}
              onSelectCaptionLanguage={speechSupported ? setCaptionLanguage : undefined}
              onToggleChat={ui.handleToggleChat}
              onToggleParticipants={ui.handleToggleParticipants}
              onSearch={ui.handleSearch}
              onToggleHandRaise={ui.handleHandRaiseAction}
              onLeave={canModerate ? handleEnd : handleLeave}
              isNoiseFilterEnabled={isNoiseFilterEnabled}
              isNoiseFilterPending={isNoiseFilterPending}
              onToggleNoiseFilter={
                canToggleNoiseFilter
                  ? () => {
                      const enabling = !isNoiseFilterEnabled;
                      setNoiseFilterEnabled(enabling).catch((err) => {
                        addToast({
                          title: "Noise filter failed",
                          description: err instanceof Error ? err.message : "Could not update the noise filter.",
                          data: { variant: "error" },
                        });
                      });
                    }
                  : undefined
              }
              backgroundMode={bgEffect.mode}
              backgroundImagePath={bgEffect.imagePath}
              backgroundSupported={bgEffect.isSupported}
              backgroundProcessing={bgEffect.isProcessing}
              onBackgroundNone={bgEffect.clearEffect}
              onBackgroundBlur={bgEffect.setBlur}
              onBackgroundImage={bgEffect.setImage}
            />
          </SuspenseBoundary>
        </div>
      )}

      {/* ── Floating video PiP ── */}
      {hasScreenShare && !isPhone && !showVideoSidebar && (
        <SuspenseBoundary>
          <LazyFloatingVideoPip />
        </SuspenseBoundary>
      )}

      {/* ── Caption overlay ── */}
      {showCaptions && (captions.length > 0 || captionHistory.length > 0) && (
        <SuspenseBoundary>
          <LazyCaptionOverlay captions={captions} captionHistory={captionHistory} />
        </SuspenseBoundary>
      )}
      {showCaptions && !speechSupported && (
        <div className="absolute inset-x-0 bottom-16 safe-bottom z-40 pointer-events-none px-4 text-center">
          <div className="mx-auto max-w-md rounded-lg bg-black/75 px-4 py-3 text-sm text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm">
            Captions are not available in this browser. Use Chrome, Edge, or Safari when you need live captions.
          </div>
        </div>
      )}

      {canModerate && hostPermissionRequests.length > 0 && !showBottomRequestTray && (
        <div className="absolute right-4 top-16 z-[125] w-[min(22rem,calc(100vw-2rem))] md:top-20">
          <HostPermissionDock
            requests={hostPermissionRequests}
            onApproveScreenShare={handleApproveScreenShare}
            onDenyScreenShare={handleDenyScreenShare}
            onApproveWhiteboard={handleApproveWhiteboard}
            onDenyWhiteboard={handleDenyWhiteboard}
          />
        </div>
      )}

      {showBottomRequestTray && (
        <div
          className="absolute left-1/2 z-[130] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2"
          style={{
            bottom: isPhone
              ? "calc(env(safe-area-inset-bottom, 0px) + 140px)"
              : "calc(env(safe-area-inset-bottom, 0px) + 72px)",
          }}
        >
          <HostPermissionDock
            compact
            requests={hostPermissionRequests}
            onApproveScreenShare={handleApproveScreenShare}
            onDenyScreenShare={handleDenyScreenShare}
            onApproveWhiteboard={handleApproveWhiteboard}
            onDenyWhiteboard={handleDenyWhiteboard}
          />
        </div>
      )}

      {!canModerate && (
        <ParticipantPermissionBanner
          state={screenShareRequestState}
          isPreparing={isPreparingScreenShare}
          hasPrepared={hasPreparedScreenShare}
          hasPermission={hasScreenSharePermission}
          onCancel={handleCancelScreenShareRequest}
        />
      )}

      {/* ── Side panels ── */}
      {isPhone ? (
        <>
          <BottomSheet open={ui.showParticipants} onClose={() => ui.setShowParticipants(false)} title="Participants">
            <SuspenseBoundary>
              <LazyModernParticipantsPanel
                participants={participantsList}
                currentUserId={currentUserId}
                onClose={() => ui.setShowParticipants(false)}
                hideHeader
                className="h-full rounded-none shadow-none ring-0 backdrop-blur-none bg-transparent"
              />
            </SuspenseBoundary>
          </BottomSheet>
          <BottomSheet open={ui.showChat} onClose={() => ui.setShowChat(false)} title="Chat">
            <SuspenseBoundary>
              <LazyModernLiveChat
                messages={chatMessages}
                currentUserId={currentUserId}
                onSendMessage={sendChatMessage}
                onClose={() => ui.setShowChat(false)}
                hideHeader
                className="h-full rounded-none shadow-none ring-0 backdrop-blur-none bg-transparent"
              />
            </SuspenseBoundary>
          </BottomSheet>
          <BottomSheet open={ui.showSearch} onClose={() => ui.setShowSearch(false)} title="Search the internet">
            <SuspenseBoundary>
              <LazyWikiSearchPanel
                onClose={() => ui.setShowSearch(false)}
                triggerQuery={ui.wikiQuery}
                className="h-full w-full rounded-none ring-0 shadow-none bg-transparent"
                userName={currentUserName}
                onAddImageToWhiteboard={
                  whiteboardReady ? handleAddWikiImageToWhiteboard : undefined
                }
                onBroadcastSearch={ui.handleWikiBroadcast}
                remoteSearch={ui.remoteWikiSearch}
              />
            </SuspenseBoundary>
          </BottomSheet>
          <BottomSheet
            open={showCaptionLanguagePicker && speechSupported}
            onClose={() => setShowCaptionLanguagePicker(false)}
            title="Caption language"
          >
            <SuspenseBoundary>
              <LazyCaptionLanguagePicker
                country={captionCountry}
                selectedLanguage={captionLanguage}
                onSelectLanguage={(language: string) => {
                  setCaptionLanguage(language);
                  setShowCaptionLanguagePicker(false);
                }}
                className="h-full"
                autoFocusSearch
              />
            </SuspenseBoundary>
          </BottomSheet>
          {canModerate && (
            <BottomSheet open={ui.showHandQueue} onClose={() => ui.setShowHandQueue(false)} title="Hand Raises">
              <SuspenseBoundary>
                <LazyHandRaisePanel
                  queue={handRaiseQueue}
                  onApprove={approveHandRaise}
                  onDismiss={dismissHandRaise}
                  onClose={() => ui.setShowHandQueue(false)}
                />
              </SuspenseBoundary>
            </BottomSheet>
          )}
        </>
      ) : (
        <>
          {ui.showParticipants && (
            <div className={cn("absolute top-13 bottom-3 z-[100]", desktopPanelRightOffsetClass)}>
              <SuspenseBoundary>
                <LazyModernParticipantsPanel
                  participants={participantsList}
                  currentUserId={currentUserId}
                  onClose={() => ui.setShowParticipants(false)}
                />
              </SuspenseBoundary>
            </div>
          )}
          {ui.showChat && (
            <div className={cn("absolute top-13 bottom-3 z-[100]", desktopPanelRightOffsetClass)}>
              <SuspenseBoundary>
                <LazyModernLiveChat
                  messages={chatMessages}
                  currentUserId={currentUserId}
                  onSendMessage={sendChatMessage}
                  onClose={() => ui.setShowChat(false)}
                  className="h-full"
                />
              </SuspenseBoundary>
            </div>
          )}
          {canModerate && ui.showHandQueue && (
            <div className={cn("absolute top-13 bottom-3 z-[100]", desktopPanelRightOffsetClass)}>
              <SuspenseBoundary>
                <LazyHandRaisePanel
                  queue={handRaiseQueue}
                  onApprove={approveHandRaise}
                  onDismiss={dismissHandRaise}
                  onClose={() => ui.setShowHandQueue(false)}
                />
              </SuspenseBoundary>
            </div>
          )}
          {!showWhiteboard && ui.showSearch && (
            <div className={cn("absolute top-14 z-[100]", desktopPanelRightOffsetClass)}>
              <SuspenseBoundary>
                <LazyWikiSearchPanel
                  onClose={() => ui.setShowSearch(false)}
                  triggerQuery={ui.wikiQuery}
                  userName={currentUserName}
                  onAddImageToWhiteboard={
                    whiteboardReady ? handleAddWikiImageToWhiteboard : undefined
                  }
                  onBroadcastSearch={ui.handleWikiBroadcast}
                  remoteSearch={ui.remoteWikiSearch}
                />
              </SuspenseBoundary>
            </div>
          )}
        </>
      )}
    </div>
  );
}
