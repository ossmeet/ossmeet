import * as React from "react";
import { RoomEvent, Track, type Room, type LocalTrack } from "livekit-client";
import { logError } from "@/lib/logger-client";
import {
  getScreenShareCaptureOptions,
  getScreenShareVideoPublishOptions,
  getScreenShareAudioPublishOptions,
} from "./media-quality";
import { useLiveKitScreenShare } from "./use-livekit-screen-share";
import { grantScreenShare, revokeOwnScreenShare } from "@/server/meetings/screen-share";
import type { HostPermissionRequest } from "./types";
import type { useToast } from "@/components/ui/toast";

const SCREEN_SHARE_PERMISSION_SOURCE = 3;

function hasScreenSharePublishPermission(
  participant: { permissions?: { canPublishSources?: number[] } } | null | undefined,
) {
  return participant?.permissions?.canPublishSources?.includes(SCREEN_SHARE_PERMISSION_SOURCE) ?? false;
}

export function useMeetingScreenShare({
  roomInstance,
  canModerate,
  currentUserId,
  currentUserName,
  meetingId,
  connectionId,
  addToast,
}: {
  roomInstance: Room | undefined;
  canModerate: boolean;
  currentUserId: string;
  currentUserName: string;
  meetingId: string;
  connectionId: string;
  addToast: ReturnType<typeof useToast>["add"];
}) {
  const {
    pendingRequests: screenShareRequests,
    requestState: screenShareRequestState,
    requestScreenShare,
    cancelRequest: cancelScreenShareRequest,
    approveRequest: approveScreenShareRequest,
    denyRequest: denyScreenShareRequest,
  } = useLiveKitScreenShare(roomInstance, currentUserId, currentUserName, canModerate);

  const hostPermissionRequests = React.useMemo<HostPermissionRequest[]>(
    () =>
      screenShareRequests.map((request) => ({
        kind: "screen-share" as const,
        id: `screen-${request.identity}`,
        userId: request.identity,
        userName: request.userName,
      })),
    [screenShareRequests],
  );

  const [hasScreenSharePermission, setHasScreenSharePermission] = React.useState(() =>
    roomInstance ? hasScreenSharePublishPermission(roomInstance.localParticipant) : false,
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
            ? getScreenShareVideoPublishOptions()
            : track.source === Track.Source.ScreenShareAudio
              ? getScreenShareAudioPublishOptions()
              : undefined,
        );
      }
      setPreparedScreenShareTracks(null);
      cancelScreenShareRequest();
      return true;
    } catch (err) {
      await Promise.allSettled(
        tracks.map((track) => roomInstance.localParticipant.unpublishTrack(track).catch(() => undefined)),
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

  // Sync screen share permission from room events
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

  // Cleanup prepared tracks on unmount
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
        await lp.setScreenShareEnabled(true, getScreenShareCaptureOptions(), {
          ...getScreenShareVideoPublishOptions(),
          ...getScreenShareAudioPublishOptions(),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") return;
        logError("[Meeting] Screen share error:", err);
      }
    };

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
        revokeOwnScreenShare({
          data: { meetingId, connectionId },
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
      const tracks = await lp.createScreenTracks(getScreenShareCaptureOptions());
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
    meetingId,
    connectionId,
  ]);

  // Timeout approved screen share if permission update is slow
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

  // Auto-publish prepared tracks once permission arrives
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

  const handleApproveScreenShare = React.useCallback(
    async (targetIdentity: string) => {
      try {
        await grantScreenShare({
          data: { meetingId, targetIdentity, allow: true, connectionId },
        });
        approveScreenShareRequest(targetIdentity);
      } catch (err) {
        logError("[Meeting] Failed to grant screen share:", err);
        denyScreenShareRequest(targetIdentity);
      }
    },
    [approveScreenShareRequest, denyScreenShareRequest, meetingId, connectionId],
  );

  const handleDenyScreenShare = React.useCallback(
    async (targetIdentity: string) => {
      denyScreenShareRequest(targetIdentity);
      try {
        await grantScreenShare({
          data: { meetingId, targetIdentity, allow: false, connectionId },
        });
      } catch (err) {
        logError("[Meeting] Failed to revoke screen share:", err);
      }
    },
    [denyScreenShareRequest, meetingId, connectionId],
  );

  return {
    screenShareRequestState,
    isPreparingScreenShare,
    hasPreparedScreenShare,
    hasScreenSharePermission,
    handleToggleScreenShare,
    handleCancelScreenShareRequest,
    handleApproveScreenShare,
    handleDenyScreenShare,
    hostPermissionRequests,
  };
}
