import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ConnectionState,
  RoomEvent,
  Track,
} from "livekit-client";
import {
  useConnectionState,
  useLocalParticipant,
  useTracks,
} from "@livekit/components-react";

import {
  useLiveKitChat,
  useLiveKitPresence,
  useLiveKitHandRaises,
  useLiveKitReactions,
  hasAdminGrant,
  type ReactionEvent,
  type ParticipantPresence,
  type LiveKitChatMessage,
  type HandRaise,
  type CaptionLine,
} from "@/lib/meeting";
import type { CaptionCaptureState } from "@/lib/meeting/caption-state";
import { useBackgroundEffect, type BackgroundMode } from "@/lib/meeting/use-background-effect";
import {
  type AudioCancellationStatus,
  useAudioCancellation,
} from "@/lib/meeting/use-audio-cancellation";
import { logError } from "@/lib/logger-client";
import { useResponsive } from "@/lib/hooks/use-responsive";
import { useToast } from "@/components/ui/toast";
import { useMeetingLifecycle } from "@/lib/meeting/use-meeting-lifecycle";
import { useMeetingUI } from "@/lib/meeting/use-meeting-ui";
import { useMeetingTokenRefresh } from "@/lib/meeting/use-meeting-token-refresh";
import { useMeetingScreenShare } from "@/lib/meeting/use-meeting-screen-share";
import { useMeetingRecording } from "@/lib/meeting/use-meeting-recording";
import { useMeetingStreaming } from "@/lib/meeting/use-meeting-streaming";
import { useMeetingCaptions } from "@/lib/meeting/use-meeting-captions";
import { useMeetingCamera } from "@/lib/meeting/use-meeting-camera";
import { useMeetingLeaveEnd } from "@/lib/meeting/use-meeting-leave-end";
import type { JoinResult, MeetingLifecycleHooks, HostPermissionRequest } from "./types";

// Re-export types consumed by components that import from this module
export type { MeetingLifecycleHooks, HostPermissionRequest };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface JoinSettings {
  videoDeviceId?: string;
  audioDeviceId?: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  captionLanguage: string;
}

export interface MeetingRoomContentProps {
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
  }) => void;
  onSessionRefreshFailure: (message: string) => void;
  meetingEndedExternallyRef: React.RefObject<(() => Promise<void>) | null>;
}

export interface MeetingRoomState {
  // ── Route/context props ──
  code: string;
  meetingStartTime: number;
  showConnectingOverlay: boolean;
  recordingEnabled: boolean;

  // ── Core lifecycle ──
  roomInstance: ReturnType<typeof useMeetingLifecycle>["roomInstance"];
  mediaScopeRef: ReturnType<typeof useMeetingLifecycle>["mediaScopeRef"];
  currentUserId: string;
  currentUserName: string;
  connectionQuality: "excellent" | "good" | "poor";
  handleRoomUpdate: ReturnType<typeof useMeetingLifecycle>["handleRoomUpdate"];
  disconnectRoomNow: () => Promise<void>;

  // ── Responsive ──
  isPhone: boolean;
  isTablet: boolean;
  isLandscape: boolean;
  isNarrow: boolean;
  controlBarAutoHide: boolean;
  showVideoSidebar: boolean;
  showParticipantStrip: boolean;

  // ── Connection / auth ──
  hasLocalHostGrant: boolean;
  canModerate: boolean;
  canHostManage: boolean;

  // ── Presence & participants ──
  presenceParticipants: ParticipantPresence[];
  participantsList: { id: string; name: string; role: string }[];

  // ── Chat ──
  chatMessages: LiveKitChatMessage[];
  sendChatMessage: (text: string) => void;

  // ── Hand raises ──
  handRaiseQueue: HandRaise[];
  isHandRaised: boolean;
  raiseHand: () => void;
  lowerHand: () => void;
  approveHandRaise: (identity: string) => void;
  dismissHandRaise: (identity: string) => void;

  // ── Screen share permission ──
  screenShareRequestState: "idle" | "pending" | "approved" | "denied";
  isPreparingScreenShare: boolean;
  hasPreparedScreenShare: boolean;
  hasScreenSharePermission: boolean;
  handleToggleScreenShare: () => Promise<void>;
  handleCancelScreenShareRequest: () => void;
  handleApproveScreenShare: (userId: string) => Promise<void>;
  handleDenyScreenShare: (userId: string) => Promise<void>;
  hostPermissionRequests: HostPermissionRequest[];

  // ── Recording ──
  isRecording: boolean;
  recordingPending: boolean;
  handleToggleRecording: () => Promise<void>;

  // ── Streaming ──
  isStreaming: boolean;
  streamingPending: boolean;
  handleToggleStreaming: (platform: import("@ossmeet/shared").StreamingPlatform, streamKey: string) => Promise<void>;

  // ── Captions / speech ──
  showCaptions: boolean;
  showCaptionLanguagePicker: boolean;
  setShowCaptionLanguagePicker: React.Dispatch<React.SetStateAction<boolean>>;
  captionLanguage: string;
  setCaptionLanguage: React.Dispatch<React.SetStateAction<string>>;
  captionLanguageLabel: string;
  captionCountry: string | null;
  captions: CaptionLine[];
  speechSupported: boolean;
  speechListening: boolean;
  speechPermissionDenied: boolean;
  captionCaptureState: CaptionCaptureState;
  transcriptPendingCount: number;
  transcriptFlushing: boolean;
  transcriptFlushFailed: boolean;
  autoTranscriptionEnabled: boolean;
  handleToggleCaptions: () => void;

  // ── Track state from LiveKit ──
  hasScreenShare: boolean;
  isMicOn: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;

  // ── Connection overlay ──
  isLiveKitConnecting: boolean;
  isLiveKitReconnecting: boolean;
  connectionOverlayLabel: string;

  // ── UI state (from useMeetingUI) ──
  ui: ReturnType<typeof useMeetingUI>;

  // ── Audio cancellation ──
  hasNoiseFilterFeature: boolean;
  canToggleNoiseFilter: boolean;
  isNoiseFilterEnabled: boolean;
  isNoiseFilterPending: boolean;
  noiseFilterStatus: AudioCancellationStatus;
  noiseFilterError: string | null;
  setNoiseFilterEnabled: (enabled: boolean) => Promise<void>;

  // ── Background effect ──
  bgEffect: {
    mode: BackgroundMode;
    imagePath: string | null;
    isSupported: boolean;
    isProcessing: boolean;
    lastError: string | null;
    setBlur: () => void;
    setImage: (path: string) => void;
    clearEffect: () => void;
  };

  // ── Camera device switching ──
  videoDevices: MediaDeviceInfo[];
  currentVideoDeviceId: string | undefined;
  handleSelectVideoDevice: (deviceId: string) => Promise<void>;
  refreshVideoDevices: () => Promise<void>;

  // ── Leave / End ──
  showEndConfirm: boolean;
  setShowEndConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  handleLeave: () => Promise<void>;
  handleEnd: () => Promise<void>;
  confirmLeave: () => Promise<void>;
  confirmEnd: () => Promise<void>;

  // ── Toast helper ──
  addToast: ReturnType<typeof useToast>["add"];
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useMeetingRoom(
  props: MeetingRoomContentProps,
  lifecycleHooks?: MeetingLifecycleHooks,
  broadcastWikiSearch?: (data: Record<string, unknown>) => void,
): MeetingRoomState {
  const {
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
  } = props;

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { add: addToast } = useToast();
  const { isPhone, isTablet, isLandscape, controlBarAutoHide, showVideoSidebar, showParticipantStrip } = useResponsive();
  const isNarrow = isPhone || (isTablet && !isLandscape);

  // ── Core lifecycle ──
  const {
    roomInstance,
    mediaScopeRef,
    currentUserId,
    currentUserName,
    connectionQuality,
    handleRoomUpdate,
    disconnectRoomNow,
  } = useMeetingLifecycle();

  // ── Token auto-refresh ──
  useMeetingTokenRefresh({
    showConnectingOverlay,
    meetingId: joinResult.meetingId,
    connectionId: joinResult.connectionId,
    expiresIn: joinResult.expiresIn,
    onJoinResultUpdate,
    onSessionRefreshFailure,
    disconnectRoomNow,
  });

  // ── Host grant ──
  const [hasLocalHostGrant, setHasLocalHostGrant] = React.useState(joinResult.isHost || !!joinResult.isActingModerator);

  React.useEffect(() => {
    if (!roomInstance) {
      setHasLocalHostGrant(joinResult.isHost || !!joinResult.isActingModerator);
      return;
    }

    const syncLocalHostGrant = () => {
      setHasLocalHostGrant(joinResult.isHost || !!joinResult.isActingModerator || hasAdminGrant(roomInstance.localParticipant));
    };

    syncLocalHostGrant();
    roomInstance.on(RoomEvent.ParticipantMetadataChanged, syncLocalHostGrant);
    return () => {
      roomInstance.off(RoomEvent.ParticipantMetadataChanged, syncLocalHostGrant);
    };
  }, [joinResult.isActingModerator, joinResult.isHost, roomInstance]);

  const canModerate = hasLocalHostGrant;
  const canHostManage = joinResult.isHost;

  // ── Presence, chat, hand raises, reactions ──
  const { participants: presenceParticipants } = useLiveKitPresence(roomInstance);

  const handleSendError = React.useCallback(() => {
    logError("[Meeting] Failed to send message");
  }, []);

  const { messages: chatMessages, sendMessage: sendChatMessage } = useLiveKitChat(
    roomInstance,
    currentUserId,
    currentUserName,
    100,
    handleSendError,
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

  // ── Screen share ──
  const screenShare = useMeetingScreenShare({
    roomInstance,
    canModerate,
    currentUserId,
    currentUserName,
    meetingId: joinResult.meetingId,
    connectionId: joinResult.connectionId,
    addToast,
  });

  // ── LiveKit track state ──
  const hasScreenShare = useTracks([Track.Source.ScreenShare], { onlySubscribed: true }).length > 0;

  const liveKitConnectionState = useConnectionState();
  const isLiveKitConnecting = liveKitConnectionState === ConnectionState.Connecting;
  const isLiveKitReconnecting =
    liveKitConnectionState === ConnectionState.Reconnecting ||
    liveKitConnectionState === ConnectionState.SignalReconnecting;
  const connectionOverlayLabel = isLiveKitReconnecting ? "Reconnecting meeting..." : "Joining meeting...";

  const { localParticipant } = useLocalParticipant();
  const isMicOn = localParticipant.isMicrophoneEnabled;
  const isCameraOn = localParticipant.isCameraEnabled;
  const isScreenSharing = localParticipant.isScreenShareEnabled;

  // ── Captions ──
  const captions = useMeetingCaptions({
    roomInstance,
    meetingId: joinResult.meetingId,
    admissionId: joinResult.admissionId,
    connectionId: joinResult.connectionId,
    participantIdentity: currentUserId || joinResult.participantIdentity,
    participantName: currentUserName || joinResult.participantName,
    initialCaptionLanguage: joinSettings.captionLanguage,
    isMicOn,
    showConnectingOverlay,
  });

  // ── Recording ──
  const recording = useMeetingRecording({
    meetingId: joinResult.meetingId,
    recordingActive: joinResult.recordingActive ?? false,
    activeEgressId: joinResult.activeEgressId ?? null,
    roomInstance,
    addToast,
  });

  // ── Streaming ──
  const streaming = useMeetingStreaming({
    meetingId: joinResult.meetingId,
    streamingActive: joinResult.streamingActive ?? false,
    activeStreamEgressId: joinResult.activeStreamEgressId ?? null,
    roomInstance,
    addToast,
  });

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
    broadcastWikiSearch,
  });

  // ── Audio cancellation ──
  const {
    hasNoiseFilterFeature,
    canToggleNoiseFilter,
    setNoiseFilterEnabled,
    isNoiseFilterEnabled,
    isNoiseFilterPending,
    status: noiseFilterStatus,
    lastError: noiseFilterError,
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

  // ── Camera ──
  const camera = useMeetingCamera({ roomInstance, isCameraOn, addToast });

  // ── Leave / End ──
  const leaveEnd = useMeetingLeaveEnd({
    meetingId: joinResult.meetingId,
    connectionId: joinResult.connectionId,
    admissionId: joinResult.admissionId,
    code,
    isAuthenticated,
    navigate,
    queryClient,
    onIntentionalDisconnect,
    lifecycleHooks,
    flushTranscripts: captions.flushTranscripts,
    disconnectRoomNow,
    addToast,
    meetingEndedExternallyRef,
  });

  // ── Derived ──
  const participantsList = React.useMemo(
    () =>
      presenceParticipants.map((p) => ({
        id: p.identity,
        name: p.userName,
        role: p.role,
      })),
    [presenceParticipants],
  );

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------
  return {
    // Route/context props
    code,
    meetingStartTime,
    showConnectingOverlay,
    recordingEnabled: joinResult.recordingEnabled ?? false,

    // Core lifecycle
    roomInstance,
    mediaScopeRef,
    currentUserId,
    currentUserName,
    connectionQuality,
    handleRoomUpdate,
    disconnectRoomNow,

    // Responsive
    isPhone,
    isTablet,
    isLandscape,
    isNarrow,
    controlBarAutoHide,
    showVideoSidebar,
    showParticipantStrip,

    // Connection / auth
    hasLocalHostGrant,
    canModerate,
    canHostManage,

    // Presence & participants
    presenceParticipants,
    participantsList,

    // Chat
    chatMessages,
    sendChatMessage,

    // Hand raises
    handRaiseQueue,
    isHandRaised,
    raiseHand,
    lowerHand,
    approveHandRaise,
    dismissHandRaise,

    // Screen share
    screenShareRequestState: screenShare.screenShareRequestState,
    isPreparingScreenShare: screenShare.isPreparingScreenShare,
    hasPreparedScreenShare: screenShare.hasPreparedScreenShare,
    hasScreenSharePermission: screenShare.hasScreenSharePermission,
    handleToggleScreenShare: screenShare.handleToggleScreenShare,
    handleCancelScreenShareRequest: screenShare.handleCancelScreenShareRequest,
    handleApproveScreenShare: screenShare.handleApproveScreenShare,
    handleDenyScreenShare: screenShare.handleDenyScreenShare,
    hostPermissionRequests: screenShare.hostPermissionRequests,

    // Recording
    isRecording: recording.isRecording,
    recordingPending: recording.recordingPending,
    handleToggleRecording: recording.handleToggleRecording,

    // Streaming
    isStreaming: streaming.isStreaming,
    streamingPending: streaming.streamingPending,
    handleToggleStreaming: streaming.handleToggleStreaming,

    // Captions / speech
    showCaptions: captions.showCaptions,
    showCaptionLanguagePicker: captions.showCaptionLanguagePicker,
    setShowCaptionLanguagePicker: captions.setShowCaptionLanguagePicker,
    captionLanguage: captions.captionLanguage,
    setCaptionLanguage: captions.setCaptionLanguage,
    captionLanguageLabel: captions.captionLanguageLabel,
    captionCountry: captions.captionCountry,
    captions: captions.captions,
    speechSupported: captions.speechSupported,
    speechListening: captions.speechListening,
    speechPermissionDenied: captions.speechPermissionDenied,
    captionCaptureState: captions.captionCaptureState,
    transcriptPendingCount: captions.transcriptPendingCount,
    transcriptFlushing: captions.transcriptFlushing,
    transcriptFlushFailed: captions.transcriptFlushFailed,
    autoTranscriptionEnabled: captions.autoTranscriptionEnabled,
    handleToggleCaptions: captions.handleToggleCaptions,

    // Track state from LiveKit
    hasScreenShare,
    isMicOn,
    isCameraOn,
    isScreenSharing,

    // Connection overlay
    isLiveKitConnecting,
    isLiveKitReconnecting,
    connectionOverlayLabel,

    // UI state
    ui,

    // Audio cancellation
    hasNoiseFilterFeature,
    canToggleNoiseFilter,
    isNoiseFilterEnabled,
    isNoiseFilterPending,
    noiseFilterStatus,
    noiseFilterError,
    setNoiseFilterEnabled,

    // Background effect
    bgEffect,

    // Camera device switching
    videoDevices: camera.videoDevices,
    currentVideoDeviceId: camera.currentVideoDeviceId,
    handleSelectVideoDevice: camera.handleSelectVideoDevice,
    refreshVideoDevices: camera.refreshVideoDevices,

    // Leave / End
    showEndConfirm: leaveEnd.showEndConfirm,
    setShowEndConfirm: leaveEnd.setShowEndConfirm,
    handleLeave: leaveEnd.handleLeave,
    handleEnd: leaveEnd.handleEnd,
    confirmLeave: leaveEnd.confirmLeave,
    confirmEnd: leaveEnd.confirmEnd,

    // Toast helper
    addToast,
  };
}
