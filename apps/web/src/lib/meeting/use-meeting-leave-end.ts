import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { logError } from "@/lib/logger-client";
import { leaveMeeting, endMeeting } from "@/server/meetings/leave-end";
import { clearReconnectAdmissionId } from "./reconnect-storage";
import { queryKeys } from "@/lib/query-keys";
import type { MeetingLifecycleHooks } from "./types";
import type { useToast } from "@/components/ui/toast";

export function useMeetingLeaveEnd({
  meetingId,
  connectionId,
  admissionId,
  code,
  isAuthenticated,
  navigate,
  queryClient,
  onIntentionalDisconnect,
  lifecycleHooks,
  flushTranscripts,
  disconnectRoomNow,
  addToast,
  meetingEndedExternallyRef,
}: {
  meetingId: string;
  connectionId: string;
  admissionId: string;
  code: string;
  isAuthenticated: boolean;
  navigate: ReturnType<typeof useNavigate>;
  queryClient: ReturnType<typeof useQueryClient>;
  onIntentionalDisconnect: () => void;
  lifecycleHooks?: MeetingLifecycleHooks;
  flushTranscripts: () => Promise<void>;
  disconnectRoomNow: () => Promise<void>;
  addToast: ReturnType<typeof useToast>["add"];
  meetingEndedExternallyRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  React.useEffect(() => {
    meetingEndedExternallyRef.current = async () => {
      await flushTranscripts().catch(() => {});
      if (isAuthenticated) {
        clearReconnectAdmissionId(code, true);
        navigate({ to: "/dashboard/$code", params: { code } });
        return;
      }
      navigate({
        to: "/recap/$code",
        params: { code },
        search: { meetingId, admissionId },
      });
    };
    return () => {
      meetingEndedExternallyRef.current = null;
    };
  }, [
    meetingEndedExternallyRef,
    flushTranscripts,
    code,
    isAuthenticated,
    navigate,
    meetingId,
    admissionId,
  ]);

  const handleLeave = React.useCallback(async () => {
    onIntentionalDisconnect();
    await lifecycleHooks?.onBeforeLeave?.();
    await flushTranscripts().catch(() => {});
    await disconnectRoomNow();
    try {
      await leaveMeeting({
        data: { sessionId: meetingId, connectionId },
      });
    } catch (err) {
      logError("[Meeting] Failed to leave:", err);
    }
    clearReconnectAdmissionId(code, isAuthenticated);
    const recapPath = `/dashboard/${code}`;
    navigate(
      isAuthenticated
        ? { to: "/dashboard/$code", params: { code } }
        : { to: "/auth", search: { mode: "login", redirect: recapPath } },
    );
  }, [
    meetingId,
    connectionId,
    isAuthenticated,
    navigate,
    onIntentionalDisconnect,
    lifecycleHooks,
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
    try {
      await lifecycleHooks?.onBeforeEnd?.();
    } catch (err) {
      logError("[Meeting] Failed to run onBeforeEnd hook:", err);
      addToast({
        title: "Pre-end action failed",
        description: "The meeting will end, but some data may not have been saved.",
        data: { variant: "error" },
      });
    }
    await flushTranscripts().catch(() => {});
    try {
      await endMeeting({ data: { sessionId: meetingId } });
    } catch (err) {
      logError("[Meeting] Failed to end:", err);
      addToast({
        title: "Could not end meeting",
        description: "Please try again.",
        data: { variant: "error" },
      });
      return;
    }
    // Mark intentional only after the server confirms the room is being torn
    // down — so that if endMeeting() throws, external disconnects (webhook,
    // another host) still trigger the normal handling path in the parent.
    onIntentionalDisconnect();
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.active() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.recent() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.summary(code) }),
    ]);
    await disconnectRoomNow();
    clearReconnectAdmissionId(code, true);
    navigate({ to: "/dashboard/$code", params: { code } });
  }, [
    addToast,
    meetingId,
    navigate,
    onIntentionalDisconnect,
    lifecycleHooks,
    flushTranscripts,
    disconnectRoomNow,
    code,
    queryClient,
  ]);

  return {
    showEndConfirm,
    setShowEndConfirm,
    handleLeave,
    handleEnd,
    confirmLeave,
    confirmEnd,
  };
}
