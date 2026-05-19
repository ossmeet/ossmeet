import * as React from "react";
import { RoomEvent, type Room } from "livekit-client";
import { logError } from "@/lib/logger-client";
import { toggleStreaming } from "@/server/meetings/streaming";
import type { StreamingPlatform } from "@ossmeet/shared";
import type { useToast } from "@/components/ui/toast";

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}

export function useMeetingStreaming({
  meetingId,
  streamingActive,
  activeStreamEgressId,
  roomInstance,
  addToast,
}: {
  meetingId: string;
  streamingActive: boolean;
  activeStreamEgressId: string | null;
  roomInstance: Room | undefined;
  addToast: ReturnType<typeof useToast>["add"];
}) {
  const [isStreaming, setIsStreaming] = React.useState(streamingActive);
  const [streamEgressId, setStreamEgressId] = React.useState<string | null>(activeStreamEgressId);
  const [streamingRequestPending, setStreamingRequestPending] = React.useState(false);

  // Refs so the stable metadata listener closure can read current values
  // without being torn down and re-attached on every render.
  const isStreamingRef = React.useRef(isStreaming);
  isStreamingRef.current = isStreaming;
  const addToastRef = React.useRef(addToast);
  addToastRef.current = addToast;
  // Set to true while a user-initiated stop is in flight so the metadata
  // listener doesn't double-fire an "ended unexpectedly" toast.
  const stopInitiatedRef = React.useRef(false);

  React.useEffect(() => {
    setIsStreaming(streamingActive);
    setStreamEgressId(activeStreamEgressId);
  }, [streamingActive, activeStreamEgressId]);

  React.useEffect(() => {
    if (!roomInstance) return;
    const handleMetadataChanged = (metadata: string | undefined) => {
      if (!metadata) return;
      try {
        const parsed = JSON.parse(metadata) as { egressMode?: "recording" | "streaming" | null };
        if ("egressMode" in parsed) {
          const nowStreaming = parsed.egressMode === "streaming";
          if (!nowStreaming && isStreamingRef.current && !stopInitiatedRef.current) {
            addToastRef.current({
              title: "Stream disconnected",
              description: "Your live stream ended unexpectedly. Check your stream key and try again.",
              data: { variant: "error" },
            });
          }
          setIsStreaming(nowStreaming);
        }
      } catch {
        // non-JSON or unrelated metadata
      }
    };
    roomInstance.on(RoomEvent.RoomMetadataChanged, handleMetadataChanged);
    return () => {
      roomInstance.off(RoomEvent.RoomMetadataChanged, handleMetadataChanged);
    };
  }, [roomInstance]);

  const handleToggleStreaming = React.useCallback(
    async (platform: StreamingPlatform, streamKey: string) => {
      if (streamingRequestPending) return;
      setStreamingRequestPending(true);
      const action = isStreaming ? "stop" : "start";
      if (action === "stop") stopInitiatedRef.current = true;
      try {
        const result = await toggleStreaming({
          data: {
            sessionId: meetingId,
            action,
            platform: action === "start" ? platform : undefined,
            streamKey: action === "start" ? streamKey : undefined,
            egressId: streamEgressId ?? undefined,
          },
        });
        const streamingNowActive = result.status === "streaming";
        setIsStreaming(streamingNowActive);
        setStreamEgressId(result.egressId);
        addToast({
          title: streamingNowActive ? "Streaming live" : "Stream ended",
          description: streamingNowActive ? "Your meeting is now live." : "Stream has ended.",
          data: { variant: streamingNowActive ? "success" : "info" },
        });
      } catch (err) {
        logError("[Meeting] Streaming toggle failed:", err);
        addToast({
          title: action === "start" ? "Stream failed to start" : "Could not stop stream",
          description: getErrorMessage(err),
          data: { variant: "error" },
        });
      } finally {
        stopInitiatedRef.current = false;
        setStreamingRequestPending(false);
      }
    },
    [addToast, streamEgressId, isStreaming, meetingId, streamingRequestPending],
  );

  return {
    isStreaming,
    streamEgressId,
    streamingPending: streamingRequestPending,
    handleToggleStreaming,
  };
}
