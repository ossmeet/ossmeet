import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import {
  AudioPresets,
  DisconnectReason,
  VideoPresets,
  type RoomConnectOptions,
  type RoomOptions,
} from "livekit-client";

import { MeetingRoomContent } from "@/components/meeting/meeting-room";
import { PreJoinScreen, stopWarmupAudio } from "@/components/meeting/pre-join-screen";
import { getServerErrorCode } from "@/lib/errors";
import { logError, logWarn } from "@/lib/logger-client";
import { markMeetingEntryMetric } from "@/lib/meeting/entry-metrics";
import { joinMeeting } from "@/server/meetings/join";
import { leaveMeeting } from "@/server/meetings/leave-end";
import { sessionQueryOptions } from "@/queries/session";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  installRtcConfigurationSanitizer,
  sanitizeRtcConfiguration,
} from "@/lib/meeting/rtc-config-sanitizer";
import {
  browserSupportsMediaConstraint,
  getCameraCaptureDefaults,
  getCameraPublishDefaults,
  getVoiceAudioCaptureDefaults,
} from "@/lib/meeting/media-quality";
import type { JoinResult } from "@/lib/meeting/types";
import {
  loadReconnectAdmissionId,
  persistReconnectAdmissionId,
  clearReconnectAdmissionId,
} from "@/lib/meeting/reconnect-storage";
import { preloadWhiteboard } from "@whiteboard/runtime";

installRtcConfigurationSanitizer();

function preloadMeetingRoomUi() {
  return Promise.all([
    import("@/components/meeting/top-control-bar"),
    import("@/components/meeting/caption-language-picker"),
    import("@/components/meeting/modern-participants-panel"),
    import("@/components/meeting/modern-chat"),
    import("@/components/meeting/hand-raise-panel"),
    import("@/components/meeting/modern-video-layout"),
    import("@/components/meeting/caption-overlay"),
    import("@/components/meeting/floating-video-pip"),
    import("@/components/meeting/quantum-action-pill"),
    import("@/components/meeting/modern-mobile-participant-strip"),
    import("@/components/meeting/end-meeting-dialog"),
    preloadWhiteboard(),
  ]);
}

export const Route = createLazyFileRoute("/$code")({
  component: MeetingRoute,
});

const GENERIC_JOIN_ERROR_MESSAGE = "Could not join meeting. Please try again.";

function getJoinErrorMessage(error: unknown): string {
  switch (getServerErrorCode(error)) {
    case "MEETING_NOT_STARTED":
      return "Meeting hasn't started yet.";
    case "MEETING_LOCKED":
      return "The host has locked this meeting.";
    case "AWAITING_APPROVAL":
      return "Waiting for the host to admit you.";
    case "PLAN_LIMIT_REACHED":
      return "Meeting is full.";
    case "UNAUTHORIZED":
      return "Sign in to join this meeting.";
    case "FORBIDDEN":
      return "You don't have access to this meeting.";
    case "NOT_FOUND":
      return "This meeting is no longer available.";
    case "RATE_LIMITED":
      return "Too many attempts. Please try again later.";
    default:
      return GENERIC_JOIN_ERROR_MESSAGE;
  }
}

// Baseline media policy. See apps/web/src/lib/meeting/media-quality.ts
// for codec selection — the per-environment helpers override the codec,
// bitrate, and simulcast layers below at room construction time.
const ROOM_OPTIONS: RoomOptions = {
  dynacast: true,
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
    frameRate: 30,
    facingMode: "user",
  },
  audioCaptureDefaults: {
    ...getVoiceAudioCaptureDefaults(),
    // voiceIsolation is added at runtime only when the browser advertises
    // support (Safari/WebKit). Hardcoding it breaks Firefox/Chrome which
    // reject unknown constraints.
  },
  publishDefaults: {
    audioPreset: AudioPresets.speech,
    videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720],
    screenShareSimulcastLayers: [VideoPresets.h720, VideoPresets.h1080],
    dtx: true,
    red: true,
    stopMicTrackOnMute: false,
    videoEncoding: {
      maxBitrate: 3_500_000,
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

type MeetingPhase =
  | "prejoin"
  | "joining"
  | "connecting"
  | "connected"
  | "error";
const CONNECTING_TIMEOUT_MS = 20_000;
const WAITING_POLL_INTERVAL_MS = 5_000;
const AUTO_REJOIN_ATTEMPT_DELAYS_MS = [0, 1_500, 5_000] as const;

// Compat (multi-PC) mode is opt-in per attempt: the default is the more
// efficient single-PC mode, and `handleRoomError` flips this to `true` as a
// one-shot fallback when the initial signal connection fails. There's no
// browser today that we want to start in compat mode.
const COMPAT_PEER_CONNECTION_DEFAULT = false;

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

function getUnsupportedBrowserBlockReason(): string | null {
  if (typeof navigator === "undefined") return null;

  const ua = navigator.userAgent || "";
  const lower = ua.toLowerCase();

  if (
    /instagram|fbav|fban|fb_iab|fbiab|twitter|snapchat|linkedin|wechat|micromessenger|tiktok|bytedance/i.test(
      ua,
    )
  ) {
    return "This in-app browser doesn't support video calls. Open this link in Safari or Chrome to join.";
  }

  const isAppleMobile = /iphone|ipad|ipod/.test(lower);
  const majorIos = getMajorVersionFromUa(ua, /OS (\d+)_/i);
  if (
    isAppleMobile &&
    Number.isFinite(majorIos) &&
    majorIos < SUPPORTED_BROWSER_BASELINES.ios
  ) {
    return "This iOS Safari version is not supported. Use iOS 16+ Safari (or a newer device) to join meetings.";
  }

  const majorEdge = getMajorVersionFromUa(ua, /Edg\/(\d+)/i);
  if (
    Number.isFinite(majorEdge) &&
    majorEdge < SUPPORTED_BROWSER_BASELINES.chromium
  ) {
    return "This Edge version is not supported. Use Edge 120+ to join meetings.";
  }

  const majorFirefox = getMajorVersionFromUa(ua, /Firefox\/(\d+)/i);
  if (
    Number.isFinite(majorFirefox) &&
    majorFirefox < SUPPORTED_BROWSER_BASELINES.firefox
  ) {
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

function ConnectingCard({ message, subtext }: { message: string; subtext: string }) {
  return (
    <div
      className="relative flex h-dvh w-full items-center justify-center overflow-hidden"
      style={{ background: "#f2f0ec" }}
    >
      <div
        className="liquid-blob-teal"
        style={{
          width: 600,
          height: 600,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          opacity: 0.5,
        }}
      />
      <div className="relative rounded-2xl border border-stone-200 bg-white/90 px-12 py-10 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-50 to-teal-100 shadow-sm">
          <div
            className="liquid-spinner-light"
            style={{ width: 24, height: 24, borderWidth: 2 }}
          />
        </div>
        <p className="text-base font-semibold text-stone-700">{message}</p>
        <p className="mt-1.5 text-sm text-stone-500">{subtext}</p>
        <div className="mt-3 flex justify-center gap-1.5">
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: "0ms" }} />
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: "150ms" }} />
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

function MeetingRoute() {
  const { code } = Route.useParams();
  const { lookup } = Route.useLoaderData();
  const navigate = useNavigate();
  const [phase, setPhase] = React.useState<MeetingPhase>("prejoin");
  const [waitingForHost, setWaitingForHost] = React.useState(false);
  const [joinResult, setJoinResult] = React.useState<JoinResult | null>(null);
  const [joinSettings, setJoinSettings] =
    React.useState<JoinSettings | null>(null);
  const [shouldConnectRoom, setShouldConnectRoom] = React.useState(false);
  const [useCompatPeerConnection, setUseCompatPeerConnection] =
    React.useState<boolean>(COMPAT_PEER_CONNECTION_DEFAULT);
  const [error, setError] = React.useState<string | null>(null);
  const intentionalDisconnectRef = React.useRef(false);
  const hasConnectedRef = React.useRef(false);
  const attemptedCompatPeerConnectionFallbackRef = React.useRef(false);
  const failedConnectLeaveIssuedRef = React.useRef<string | null>(null);
  const joinAttemptIdRef = React.useRef(0);
  const pollJoinInFlightRef = React.useRef(false);
  const meetingStartTimeRef = React.useRef<number>(0);
  const autoRejoinAttemptCountRef = React.useRef(0);
  const autoRejoinTimerRef = React.useRef<number | null>(null);
  const meetingEndedExternallyRef = React.useRef<(() => Promise<void>) | null>(
    null,
  );
  const lastJoinDisplayNameRef = React.useRef<string | null>(null);
  const liveKitConnectTokenRef = React.useRef<{
    connectionId: string;
    token: string;
  } | null>(null);

  const { data: sessionData } = useQuery(sessionQueryOptions());
  const authenticatedUser = sessionData?.user
    ? { name: sessionData.user.name }
    : undefined;

  React.useEffect(() => {
    markMeetingEntryMetric("routeMountedAt", { code });
    preloadMeetingRoomUi().catch(() => {});
    return () => {
      // Safety-net: stop the pre-join warmup stream if the user navigates away
      // from the meeting route entirely without completing a join.
      stopWarmupAudio();
    };
  }, [code]);

  React.useEffect(() => {
    if (phase !== "connected") return;
    document.body.classList.add("meet-route");
    return () => document.body.classList.remove("meet-route");
  }, [phase]);

  const beginJoinAttempt = React.useCallback(() => {
    joinAttemptIdRef.current += 1;
    return joinAttemptIdRef.current;
  }, []);

  const clearAutoRejoinTimer = React.useCallback(() => {
    if (autoRejoinTimerRef.current === null) return;
    window.clearTimeout(autoRejoinTimerRef.current);
    autoRejoinTimerRef.current = null;
  }, []);

  const resetAutoRejoinState = React.useCallback(() => {
    autoRejoinAttemptCountRef.current = 0;
    clearAutoRejoinTimer();
  }, [clearAutoRejoinTimer]);

  React.useEffect(() => {
    return () => {
      clearAutoRejoinTimer();
    };
  }, [clearAutoRejoinTimer]);

  const attemptJoin = React.useCallback(
    async (displayName: string, attemptId: number) => {
      const isAuthenticatedJoin = Boolean(sessionData?.user);
      const reconnectAdmissionId = loadReconnectAdmissionId(
        code,
        isAuthenticatedJoin,
      );

      const result = await joinMeeting({
        data: { code, displayName, reconnectAdmissionId },
      });

      if (!result.token || !result.serverUrl) {
        throw new Error("Failed to get meeting credentials");
      }

      if (joinAttemptIdRef.current !== attemptId) {
        return;
      }

      lastJoinDisplayNameRef.current = result.participantName;
    persistReconnectAdmissionId(
      code,
      result.admissionId,
      result.participantIdentity.startsWith("guest_"),
    );

    liveKitConnectTokenRef.current = {
      connectionId: result.connectionId,
      token: result.token,
    };
    setJoinResult(result as JoinResult);
      markMeetingEntryMetric("joinCredentialsReadyAt", { code });
      setPhase("connecting");
    },
    [code, sessionData?.user],
  );

  const pollJoin = React.useCallback(async () => {
    if (pollJoinInFlightRef.current) return;
    pollJoinInFlightRef.current = true;

    const attemptId = joinAttemptIdRef.current;

    try {
      const displayName = localStorage.getItem("ossmeet.user.name") || "Guest";
      await attemptJoin(displayName, attemptId);
      // attemptJoin guards its own state writes by attemptId, but the
      // success-side bookkeeping below must do the same so a stale poll
      // does not dismiss the waiting UI for a newer attempt.
      if (joinAttemptIdRef.current !== attemptId) return;
      setWaitingForHost(false);
    } catch (err) {
      if (joinAttemptIdRef.current !== attemptId) return;
      const errCode = getServerErrorCode(err);
      if (errCode !== "MEETING_NOT_STARTED") {
        logError("Failed to join meeting:", err);
        setWaitingForHost(false);
        setError(getJoinErrorMessage(err));
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
      captionLanguage = "en-US",
    ) => {
      const blockReason = getUnsupportedBrowserBlockReason();
      if (blockReason) {
        setError(blockReason);
        setPhase("error");
        return;
      }

      const attemptId = beginJoinAttempt();
      markMeetingEntryMetric("joinRequestedAt", { code });
      intentionalDisconnectRef.current = false;
      hasConnectedRef.current = false;
      attemptedCompatPeerConnectionFallbackRef.current = false;
      resetAutoRejoinState();
      pollJoinInFlightRef.current = false;
      setWaitingForHost(false);
      setShouldConnectRoom(false);
      setUseCompatPeerConnection(COMPAT_PEER_CONNECTION_DEFAULT);
      setPhase("joining");
      setError(null);

      setJoinSettings({
        videoDeviceId,
        audioDeviceId,
        videoEnabled,
        audioEnabled,
        captionLanguage,
      });

      try {
        const displayName =
          preJoinDisplayName ||
          localStorage.getItem("ossmeet.user.name") ||
          "Guest";
        await attemptJoin(displayName, attemptId);
      } catch (err) {
        if (joinAttemptIdRef.current !== attemptId) return;
        logError("Failed to join meeting:", err);
        const errCode = getServerErrorCode(err);
        if (errCode === "MEETING_NOT_STARTED") {
          setWaitingForHost(true);
          setPhase("prejoin");
          return;
        }
        setError(getJoinErrorMessage(err));
        setPhase("error");
      }
    },
    [attemptJoin, beginJoinAttempt, code, resetAutoRejoinState],
  );

  React.useEffect(() => {
    if (phase !== "error") return;
    if (hasConnectedRef.current) return;
    if (!joinResult?.meetingId || !joinResult.connectionId) return;
    if (failedConnectLeaveIssuedRef.current === joinResult.connectionId)
      return;

    failedConnectLeaveIssuedRef.current = joinResult.connectionId;
    void leaveMeeting({
      data: {
        sessionId: joinResult.meetingId,
        connectionId: joinResult.connectionId,
      },
    }).catch((err) => {
      logWarn(
        "[Meeting] Failed to cleanup participant after connect error:",
        err,
      );
    });
  }, [phase, joinResult?.meetingId, joinResult?.connectionId]);

  const handleRetry = React.useCallback(() => {
    beginJoinAttempt();
    meetingStartTimeRef.current = 0;
    intentionalDisconnectRef.current = false;
    hasConnectedRef.current = false;
    attemptedCompatPeerConnectionFallbackRef.current = false;
    resetAutoRejoinState();
    pollJoinInFlightRef.current = false;
    liveKitConnectTokenRef.current = null;
    setJoinResult(null);
    setJoinSettings(null);
    setShouldConnectRoom(false);
    setUseCompatPeerConnection(COMPAT_PEER_CONNECTION_DEFAULT);
    setWaitingForHost(false);
    setPhase("prejoin");
    setError(null);
  }, [beginJoinAttempt, resetAutoRejoinState]);

  const handleJoinResultUpdate = React.useCallback(
    (updates: {
      token: string;
      expiresIn: number;
      turnServers: JoinResult["turnServers"];
      connectionId?: string;
      admissionId?: string;
      participantIdentity?: string;
      isHost?: boolean;
      isActingModerator?: boolean;
      whiteboardToken?: string | null;
      whiteboardUrl?: string | null;
      recordingActive?: boolean;
      activeEgressId?: string | null;
      streamingActive?: boolean;
      activeStreamEgressId?: string | null;
    }) => {
      setJoinResult((prev) => (prev ? { ...prev, ...updates } : null));
    },
    [],
  );

  const handleSessionRefreshFailure = React.useCallback(
    (message: string) => {
      intentionalDisconnectRef.current = true;
      resetAutoRejoinState();
      setShouldConnectRoom(false);
      clearReconnectAdmissionId(code, Boolean(sessionData?.user));
      setError(message);
      setPhase("error");
    },
    [code, resetAutoRejoinState, sessionData?.user],
  );

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

  // useCompatPeerConnection is in the dep list because the compat fallback
  // path in handleRoomError sets shouldConnectRoom→false and toggles this
  // flag while phase stays "connecting"; the effect must re-fire to
  // re-arm the LiveKit connect attempt with the new RoomOptions.
  React.useEffect(() => {
    if (phase !== "connecting" || !joinResult) return;
    setShouldConnectRoom(true);
  }, [phase, joinResult, useCompatPeerConnection]);

  const roomOptions = React.useMemo<RoomOptions>(
    () => {
      const cameraCaptureDefaults = getCameraCaptureDefaults();
      const cameraPublishDefaults = getCameraPublishDefaults();
      const voiceIsolation = browserSupportsMediaConstraint("voiceIsolation")
        ? { voiceIsolation: true as const }
        : {};

      return {
        ...ROOM_OPTIONS,
        singlePeerConnection: !useCompatPeerConnection,
        publishDefaults: {
          ...ROOM_OPTIONS.publishDefaults,
          ...cameraPublishDefaults,
        },
        videoCaptureDefaults: {
          ...ROOM_OPTIONS.videoCaptureDefaults,
          ...cameraCaptureDefaults,
          deviceId: joinSettings?.videoDeviceId,
        },
        audioCaptureDefaults: {
          ...ROOM_OPTIONS.audioCaptureDefaults,
          ...voiceIsolation,
          deviceId: joinSettings?.audioDeviceId,
        },
      };
    },
    [
      joinSettings?.videoDeviceId,
      joinSettings?.audioDeviceId,
      useCompatPeerConnection,
    ],
  );

  const roomConnectOptions = React.useMemo<RoomConnectOptions | undefined>(
    () => ({
      maxRetries: 4,
      websocketTimeout: 20_000,
      peerConnectionTimeout: 20_000,
      ...(joinResult?.turnServers && joinResult.turnServers.length > 0
        ? {
            rtcConfig: sanitizeRtcConfiguration({
              iceServers: joinResult.turnServers,
            }),
          }
        : {}),
    }),
    [joinResult?.turnServers],
  );

  const handleRoomConnected = React.useCallback(() => {
    if (meetingStartTimeRef.current === 0) {
      meetingStartTimeRef.current = Date.now();
    }
    attemptedCompatPeerConnectionFallbackRef.current = false;
    resetAutoRejoinState();
    hasConnectedRef.current = true;
    // LiveKit now owns the mic — release the pre-join warmup stream.
    stopWarmupAudio();
    markMeetingEntryMetric("liveKitConnectedAt", { code });
    setPhase("connected");
  }, [code, resetAutoRejoinState]);

  const attemptAutoRejoin = React.useCallback(() => {
    const attemptIndex = autoRejoinAttemptCountRef.current;
    if (attemptIndex >= AUTO_REJOIN_ATTEMPT_DELAYS_MS.length) {
      setError("Disconnected from meeting. Please rejoin.");
      setPhase("error");
      return;
    }

    autoRejoinAttemptCountRef.current += 1;
    const attemptNumber = attemptIndex + 1;
    const delayMs = AUTO_REJOIN_ATTEMPT_DELAYS_MS[attemptIndex];

    const runAttempt = () => {
      autoRejoinTimerRef.current = null;
      const attemptId = beginJoinAttempt();
      hasConnectedRef.current = false;
      meetingStartTimeRef.current = 0;
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
        logError(
          `[Meeting] Auto-rejoin attempt ${attemptNumber} failed:`,
          err,
        );
        attemptAutoRejoin();
      });
    };

    if (delayMs > 0) {
      clearAutoRejoinTimer();
      autoRejoinTimerRef.current = window.setTimeout(runAttempt, delayMs);
      return;
    }

    runAttempt();
  }, [
    attemptJoin,
    authenticatedUser?.name,
    beginJoinAttempt,
    clearAutoRejoinTimer,
  ]);

  const handleRoomDisconnected = React.useCallback(
    (reason?: DisconnectReason) => {
      if (intentionalDisconnectRef.current) return;
      if (!hasConnectedRef.current) return;

      const meetingEnded =
        reason === DisconnectReason.ROOM_DELETED ||
        reason === DisconnectReason.ROOM_CLOSED;

      if (meetingEnded && meetingEndedExternallyRef.current) {
        intentionalDisconnectRef.current = true;
        resetAutoRejoinState();
        void meetingEndedExternallyRef.current();
        return;
      }
      attemptAutoRejoin();
    },
    [attemptAutoRejoin, resetAutoRejoinState],
  );

  const handleRoomError = React.useCallback(
    (err: unknown) => {
      const message =
        err instanceof Error
          ? err.message.toLowerCase()
          : String(err).toLowerCase();
      if (message.includes("client initiated disconnect")) return;

      if (
        !hasConnectedRef.current &&
        !attemptedCompatPeerConnectionFallbackRef.current &&
        !useCompatPeerConnection &&
        message.includes("could not establish signal connection")
      ) {
        attemptedCompatPeerConnectionFallbackRef.current = true;
        setError(null);
        setPhase("connecting");
        setUseCompatPeerConnection(true);
        setShouldConnectRoom(false);
        logWarn(
          "[Meeting] Signal connect failed; retrying with compatibility peer-connection mode",
        );
        return;
      }

      if (!hasConnectedRef.current) {
        setPhase("error");
        setError(
          message.includes("could not establish signal connection")
            ? "Couldn't reach the meeting server. Please try again."
            : "Meeting connection failed. Please try again.",
        );
      }
      logError("[Meeting] LiveKit room error:", err);
    },
    [useCompatPeerConnection],
  );

  if (phase === "prejoin") {
    return (
      <div className="relative w-full" style={{ background: "#f2f0ec" }}>
        <PreJoinScreen
          onJoin={handlePreJoin}
          waitingForHost={waitingForHost}
          noActiveSession={
            lookup.kind === "permanent" && !lookup.hasActiveSession
          }
          user={authenticatedUser}
        />
      </div>
    );
  }

  if (phase === "joining") {
    return <ConnectingCard message="Joining meeting..." subtext="Setting up your connection" />;
  }

  if (phase === "error") {
    return (
      <div
        className="relative flex h-[100dvh] flex-col items-center justify-center gap-4 overflow-hidden"
        style={{ background: "#f2f0ec" }}
      >
        <div
          className="liquid-blob-amber"
          style={{
            width: 400,
            height: 400,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            opacity: 0.5,
          }}
        />
        <div className="relative flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white/90 px-10 py-8 text-center shadow-xl">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-6 w-6 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="font-semibold text-stone-800">
            {error || "Something went wrong"}
          </p>
          <button
            onClick={handleRetry}
            className="rounded-xl bg-accent-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent-600/20 transition-colors hover:bg-accent-500"
          >
            Try again
          </button>
          <button
            onClick={() => navigate({ to: "/dashboard" })}
            className="text-sm text-stone-500 transition-colors hover:text-stone-700"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!joinResult || !joinSettings) {
    return <ConnectingCard message="Reconnecting..." subtext="Restoring your connection" />;
  }
  const liveKitConnectToken =
    liveKitConnectTokenRef.current?.connectionId === joinResult.connectionId
      ? liveKitConnectTokenRef.current.token
      : joinResult.token;

  return (
    <LiveKitRoom
      serverUrl={joinResult.serverUrl}
      token={liveKitConnectToken}
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
            onIntentionalDisconnect={() => {
              intentionalDisconnectRef.current = true;
            }}
            onJoinResultUpdate={handleJoinResultUpdate}
            onSessionRefreshFailure={handleSessionRefreshFailure}
            meetingEndedExternallyRef={meetingEndedExternallyRef}
          />
        </TooltipProvider>
      </ToastProvider>
    </LiveKitRoom>
  );
}
