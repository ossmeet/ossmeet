import { useEffect, useCallback, useState, useRef } from "react";
import type { Room } from "livekit-client";
import { ConnectionState } from "livekit-client";
import { logError, logInfo } from "@/lib/logger-client";
import { isExpectedClosedPublishError } from "./livekit-helpers";
import { MESSAGE_LIMITS, LIVEKIT_TOPICS } from "./constants";
import { useTokenBucket } from "./use-token-bucket";
import { ReceiverRateLimiter } from "./receiver-rate-limiter";

// Chat rate limit: 5 tokens, 1 token/sec refill
const CHAT_BUCKET_CAPACITY = 5;
const CHAT_BUCKET_REFILL_RATE = 1;

/**
 * Chat message — kept compatible with UI consumers.
 */
export interface LiveKitChatMessage {
  type: "chat";
  id: string;
  userId: string;
  userName: string;
  text: string;
  sentAt: number;
}

/**
 * Hook for sending/receiving chat messages via LiveKit Text Streams.
 *
 * Uses the recommended `sendText` / `registerTextStreamHandler` API
 * (publishData with topic filtering is deprecated in livekit-client >= 2.x).
 *
 * Security features preserved:
 * - Sender-side token bucket rate limiting
 * - Receiver-side per-identity rate limiting
 * - Deduplication by stream ID
 * - JWT-verified identity via participantInfo (not message payload)
 * - Local receive time (not sender timestamp)
 */
export function useLiveKitChat(
  room: Room | undefined,
  userId?: string,
  userName?: string,
  maxMessages = 100,
  onSendError?: () => void
) {
  const [messages, setMessages] = useState<LiveKitChatMessage[]>([]);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const messageIdsRef = useRef<Set<string>>(new Set());
  const rateLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { consume } = useTokenBucket(
    CHAT_BUCKET_CAPACITY,
    CHAT_BUCKET_REFILL_RATE
  );

  const roomRef = useRef(room);
  const userIdRef = useRef(userId);
  const userNameRef = useRef(userName);
  const onSendErrorRef = useRef(onSendError);
  roomRef.current = room;
  userIdRef.current = userId;
  userNameRef.current = userName;
  onSendErrorRef.current = onSendError;

  const addMessage = useCallback(
    (message: LiveKitChatMessage) => {
      if (messageIdsRef.current.has(message.id)) {
        return;
      }
      messageIdsRef.current.add(message.id);

      setMessages((prev) => {
        const updated = [...prev, message];
        if (updated.length > maxMessages) {
          const overflow = updated.length - maxMessages;
          for (let i = 0; i < overflow; i++) {
            messageIdsRef.current.delete(updated[i].id);
          }
          return updated.slice(overflow);
        }
        return updated;
      });
    },
    [maxMessages]
  );

  const removeMessage = useCallback((id: string) => {
    messageIdsRef.current.delete(id);
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      const currentRoom = roomRef.current;
      if (!currentRoom || currentRoom.state !== ConnectionState.Connected) return;

      const lp = currentRoom.localParticipant;
      const resolvedUserId = lp.identity || userIdRef.current;
      const resolvedUserName = lp.name || lp.identity || userNameRef.current;

      if (!resolvedUserId || !resolvedUserName) {
        logInfo("[LiveKitChat] Cannot send: identity not available yet");
        return;
      }

      const trimmedText = text.trim();
      if (!trimmedText || trimmedText.length > MESSAGE_LIMITS.MAX_TEXT_LENGTH) {
        return;
      }

      if (!consume()) {
        setIsRateLimited(true);
        if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
        rateLimitTimerRef.current = setTimeout(
          () => setIsRateLimited(false),
          2000
        );
        return;
      }

      // Optimistic local add before send completes
      const message: LiveKitChatMessage = {
        type: "chat",
        id: crypto.randomUUID(),
        userId: resolvedUserId,
        userName: resolvedUserName,
        text: trimmedText,
        sentAt: Date.now(),
      };

      addMessage(message);

      // Send via text stream — automatic chunking for long messages
      void currentRoom.localParticipant
        .sendText(trimmedText, {
          topic: LIVEKIT_TOPICS.CHAT,
        })
        .catch((err) => {
          if (isExpectedClosedPublishError(err)) return;
          logError("[LiveKitChat] sendText failed:", err);
          // Remove the optimistically-added message so the user doesn't see a ghost
          removeMessage(message.id);
          onSendErrorRef.current?.();
        });
    },
    [consume, addMessage, removeMessage]
  );

  // Clean up rate limit timer on unmount
  useEffect(() => {
    return () => {
      if (rateLimitTimerRef.current) {
        clearTimeout(rateLimitTimerRef.current);
        rateLimitTimerRef.current = null;
      }
    };
  }, []);

  const chatReceiverLimiterRef = useRef(new ReceiverRateLimiter());

  // Register text stream handler for incoming chat messages
  useEffect(() => {
    if (!room) return;

    const handler = async (
      reader: { info: { id: string }; readAll: () => Promise<string> },
      participantInfo: { identity: string }
    ) => {
      // Receiver-side rate limit per identity
      const senderId = participantInfo.identity ?? "unknown";
      if (!chatReceiverLimiterRef.current.shouldAllow(senderId)) return;

      try {
        const text = await reader.readAll();

        if (!text || text.length > MESSAGE_LIMITS.MAX_TEXT_LENGTH) return;

        // Resolve display name from LiveKit participant object (JWT-trusted)
        const remoteParticipant = room.remoteParticipants.get(senderId);
        const resolvedName = remoteParticipant?.name || senderId;

        addMessage({
          type: "chat",
          id: reader.info.id, // Stream ID is unique per message — natural dedup
          userId: senderId,
          userName: resolvedName,
          text,
          sentAt: Date.now(), // Local receive time, not sender timestamp
        });
      } catch (error) {
        logError("[LiveKitChat] Failed to read text stream:", error);
      }
    };

    room.registerTextStreamHandler(LIVEKIT_TOPICS.CHAT, handler);

    return () => {
      room.unregisterTextStreamHandler(LIVEKIT_TOPICS.CHAT);
    };
  }, [room, addMessage]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    messageIdsRef.current.clear();
  }, []);

  return {
    messages,
    sendMessage,
    clearMessages,
    isRateLimited,
  };
}
