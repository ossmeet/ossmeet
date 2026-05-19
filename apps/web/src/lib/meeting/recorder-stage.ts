import * as React from "react";
import { ConnectionState, RoomEvent, type Room } from "livekit-client";
import { logError } from "@/lib/logger-client";
import { isExpectedClosedPublishError } from "./livekit-helpers";
import { LIVEKIT_TOPICS } from "./constants";

export type RecorderStage = "whiteboard" | "screen_share" | "video";
const RECORDER_STAGE_HEARTBEAT_MS = 3_000;

export interface RecorderStageMessage {
  type: "recorder.stage";
  stage: RecorderStage;
  timestamp: number;
}

export function parseRecorderStageMessage(payload: Uint8Array): RecorderStageMessage | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(payload)) as Partial<RecorderStageMessage>;
    if (data.type !== "recorder.stage") return null;
    if (data.stage !== "whiteboard" && data.stage !== "screen_share" && data.stage !== "video") {
      return null;
    }
    return {
      type: "recorder.stage",
      stage: data.stage,
      timestamp: typeof data.timestamp === "number" ? data.timestamp : 0,
    };
  } catch {
    return null;
  }
}

export function publishRecorderStage(room: Room, stage: RecorderStage): void {
  if (room.state !== ConnectionState.Connected) return;

  const message: RecorderStageMessage = {
    type: "recorder.stage",
    stage,
    timestamp: Date.now(),
  };

  void room.localParticipant
    .publishData(new TextEncoder().encode(JSON.stringify(message)), {
      reliable: true,
      topic: LIVEKIT_TOPICS.RECORDER_STAGE,
    })
    .catch((err) => {
      if (isExpectedClosedPublishError(err)) return;
      logError("[RecorderStage] publishData failed:", err);
    });
}

export function useRecorderStagePublisher({
  room,
  enabled,
  stage,
}: {
  room: Room | undefined;
  enabled: boolean;
  stage: RecorderStage;
}) {
  const stageRef = React.useRef(stage);
  stageRef.current = stage;

  React.useEffect(() => {
    if (!room || !enabled) return;

    const publishCurrentStage = () => publishRecorderStage(room, stageRef.current);

    publishCurrentStage();
    room.on(RoomEvent.Connected, publishCurrentStage);
    room.on(RoomEvent.ParticipantConnected, publishCurrentStage);
    const heartbeat = window.setInterval(publishCurrentStage, RECORDER_STAGE_HEARTBEAT_MS);

    return () => {
      window.clearInterval(heartbeat);
      room.off(RoomEvent.Connected, publishCurrentStage);
      room.off(RoomEvent.ParticipantConnected, publishCurrentStage);
    };
  }, [enabled, room, stage]);
}
