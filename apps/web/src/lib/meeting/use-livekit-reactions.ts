import { useEffect, useCallback, useRef } from "react";
import type { Room } from "livekit-client";
import { ConnectionState, RoomEvent } from "livekit-client";
import { logError, logInfo } from "@/lib/logger-client";
import { isExpectedClosedPublishError } from "./livekit-helpers";
import { MESSAGE_LIMITS, LIVEKIT_TOPICS } from "./constants";
import { useTokenBucket } from "./use-token-bucket";
import { ReceiverRateLimiter } from "./receiver-rate-limiter";

// Reactions rate limit: 3 tokens, 0.5 tokens/sec refill
const REACTION_BUCKET_CAPACITY = 3;
const REACTION_BUCKET_REFILL_RATE = 0.5;

/** Maximum byte size for lossy data packets (LiveKit recommendation).
 *  Packets exceeding this may be fragmented and lost if any fragment drops. */
const MAX_LOSSY_PAYLOAD_BYTES = 1300;

/**
 * Reaction event data sent via LiveKit data channels
 */
export interface ReactionEvent {
  type: "reaction";
  userId: string;
  userName: string;
  emoji: string;
  timestamp: number;
}

/**
 * Hook for sending/receiving reactions via LiveKit Data Channels
 */
export function useLiveKitReactions(
  room: Room | undefined,
  onReaction: (reaction: ReactionEvent) => void,
  userId?: string,
  userName?: string,
  onSendError?: () => void
) {
  // Use ref for room to avoid stale closure on reconnect
  const roomRef = useRef(room);
  roomRef.current = room;
  const onReactionRef = useRef(onReaction);
  const onSendErrorRef = useRef(onSendError);
  onReactionRef.current = onReaction;
  onSendErrorRef.current = onSendError;
  const { consume } = useTokenBucket(
    REACTION_BUCKET_CAPACITY,
    REACTION_BUCKET_REFILL_RATE
  );

  const sendReaction = useCallback(
    (emoji: string) => {
      const room = roomRef.current;
      if (!room || !userId || !userName) {
        logInfo(
          "[LiveKitReactions] Cannot send reaction: missing room or user info"
        );
        return;
      }
      if (room.state !== ConnectionState.Connected) return;

      if (!emoji || emoji.length > MESSAGE_LIMITS.MAX_EMOJI_LENGTH) {
        return;
      }

      if (!consume()) {
        logInfo("[LiveKitReactions] Rate limited, dropping reaction");
        return;
      }

      const reactionEvent: ReactionEvent = {
        type: "reaction",
        userId,
        userName,
        emoji,
        timestamp: Date.now(),
      };

      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(reactionEvent));

      if (data.byteLength > MAX_LOSSY_PAYLOAD_BYTES) {
        logError(
          `[LiveKitReactions] Payload too large (${data.byteLength} bytes), dropping`
        );
        return;
      }

      void room.localParticipant
        .publishData(data, {
          reliable: false,
          topic: LIVEKIT_TOPICS.REACTIONS,
        })
        .catch((err) => {
          if (isExpectedClosedPublishError(err)) return;
          logError("[LiveKitReactions] publishData failed:", err);
          onSendErrorRef.current?.();
        });
    },
    [userId, userName, consume]
  );

  const receiverLimiterRef = useRef(new ReceiverRateLimiter());

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (
      payload: Uint8Array,
      participant?: { identity?: string },
      _kind?: unknown,
      topic?: string
    ) => {
      if (topic !== LIVEKIT_TOPICS.REACTIONS) return;

      // Receiver-side rate limit per identity
      const senderId = participant?.identity ?? "unknown";
      if (!receiverLimiterRef.current.shouldAllow(senderId)) return;

      try {
        const decoder = new TextDecoder();
        const message = decoder.decode(payload);
        const data = JSON.parse(message) as ReactionEvent;

        if (
          data.type === "reaction" &&
          data.emoji &&
          data.userId &&
          data.emoji.length <= MESSAGE_LIMITS.MAX_EMOJI_LENGTH &&
          (!data.userName ||
            data.userName.length <= MESSAGE_LIMITS.MAX_NAME_LENGTH)
        ) {
          if (participant?.identity && participant.identity !== data.userId) {
            logError(
              "[LiveKitReactions] Sender identity mismatch, ignoring"
            );
            return;
          }
          // Resolve display name from the LiveKit participant object
          const resolvedName =
            participant && "name" in participant && participant.name
              ? (participant.name as string)
              : data.userName;
          onReactionRef.current({ ...data, userName: resolvedName });
        }
      } catch (error) {
        logError("[LiveKitReactions] Failed to parse reaction:", error);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room]);

  return { sendReaction };
}
