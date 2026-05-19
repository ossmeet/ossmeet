import * as React from "react";
import { RoomEvent, type Room } from "livekit-client";
import { logError } from "@/lib/logger-client";
import { toggleRecording } from "@/server/meetings/recording";
import type { useToast } from "@/components/ui/toast";

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}

export function useMeetingRecording({
  meetingId,
  recordingActive,
  activeEgressId,
  roomInstance,
  addToast,
}: {
  meetingId: string;
  recordingActive: boolean;
  activeEgressId: string | null;
  roomInstance: Room | undefined;
  addToast: ReturnType<typeof useToast>["add"];
}) {
  const [isRecording, setIsRecording] = React.useState(recordingActive);
  const [egressId, setEgressId] = React.useState<string | null>(activeEgressId);
  const [recordingRequestPending, setRecordingRequestPending] = React.useState(false);

  React.useEffect(() => {
    setIsRecording(recordingActive);
    setEgressId(activeEgressId);
  }, [recordingActive, activeEgressId]);

  React.useEffect(() => {
    if (!roomInstance) return;
    const handleMetadataChanged = (metadata: string | undefined) => {
      if (!metadata) return;
      try {
        const parsed = JSON.parse(metadata) as { egressMode?: "recording" | "streaming" | null };
        if ("egressMode" in parsed) setIsRecording(parsed.egressMode === "recording");
      } catch {
        // non-JSON or unrelated metadata
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
          sessionId: meetingId,
          action,
          egressId: egressId ?? undefined,
        },
      });
      const recordingNowActive = result.status === "recording";
      setIsRecording(recordingNowActive);
      setEgressId(result.egressId);
      addToast({
        title: recordingNowActive ? "Recording in progress" : "Recording stopped",
        description: recordingNowActive ? "This meeting is being recorded." : "Recording has been saved.",
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
  }, [addToast, egressId, isRecording, meetingId, recordingRequestPending]);

  return {
    isRecording,
    egressId,
    recordingPending: recordingRequestPending,
    handleToggleRecording,
  };
}
