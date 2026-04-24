import { useEffect, useCallback, useState, useRef } from "react";
import type { Room, RemoteParticipant } from "livekit-client";
import { ConnectionState } from "livekit-client";
import { logError } from "@/lib/logger-client";
import { isExpectedClosedPublishError } from "./livekit-helpers";
import { LIVEKIT_TOPICS, MESSAGE_LIMITS } from "./constants";
import { hasAdminGrant } from "./participant-grants";
import { ReceiverRateLimiter } from "./receiver-rate-limiter";

/**
 * Hand raise entry in the queue
 */
export interface HandRaise {
  identity: string;
  userId: string;
  userName: string;
  raisedAt: number;
  status: "pending" | "approved" | "dismissed";
  nonce: string;
}

interface HandRaiseMessage {
  type: "hand.raise" | "hand.lower";
  userId: string;
  userName: string;
  nonce: string;
  clientTs: number;
}

interface HandQueueMessage {
  type: "hand.queue";
  seq: number;
  queue: HandRaise[];
}

interface HandActionMessage {
  type: "hand.approve" | "hand.dismiss";
  userId: string;
}

type HandMessage = HandRaiseMessage | HandQueueMessage | HandActionMessage;

/**
 * Hook for hand raise management via LiveKit Text Streams.
 *
 * Architecture: "Host as Sequencer"
 * - Participants send raise/lower via text stream (broadcast)
 * - Host maintains authoritative queue
 * - Host broadcasts queue updates to all participants
 */
export function useLiveKitHandRaises(
  room: Room | undefined,
  userId?: string,
  userName?: string,
  isAdmin = false,
  onSendError?: () => void
) {
  const [handRaiseQueue, setHandRaiseQueue] = useState<HandRaise[]>([]);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const queueSeqRef = useRef(0);

  const localQueueRef = useRef<HandRaise[]>([]);
  const seqRef = useRef(0);
  // TTL-based nonce map to prevent replay attacks while allowing cleanup of old entries
  const processedNoncesRef = useRef<Map<string, number>>(new Map());
  const lastNoncePruneAtRef = useRef(0);

  const onSendErrorRef = useRef(onSendError);
  onSendErrorRef.current = onSendError;

  const sendHandMessage = useCallback(
    (message: HandMessage) => {
      if (!room) return;
      if (room.state !== ConnectionState.Connected) return;
      void room.localParticipant
        .sendText(JSON.stringify(message), {
          topic: LIVEKIT_TOPICS.HAND,
        })
        .catch((err) => {
          if (isExpectedClosedPublishError(err)) return;
          logError("[HandRaises] sendText failed:", err);
          onSendErrorRef.current?.();
        });
    },
    [room]
  );

  const broadcastQueue = useCallback(() => {
    if (!room || !isAdmin) return;
    if (room.state !== ConnectionState.Connected) return;

    seqRef.current++;
    const message: HandQueueMessage = {
      type: "hand.queue",
      seq: seqRef.current,
      queue: localQueueRef.current,
    };

    sendHandMessage(message);

    setHandRaiseQueue([...localQueueRef.current]);
    queueSeqRef.current = seqRef.current;
  }, [room, isAdmin, sendHandMessage]);

  const raiseHand = useCallback(() => {
    if (!room || !userId || !userName || isAdmin) return;
    if (room.state !== ConnectionState.Connected) return;

    const nonce = crypto.randomUUID();
    const message: HandRaiseMessage = {
      type: "hand.raise",
      userId,
      userName,
      nonce,
      clientTs: Date.now(),
    };

    sendHandMessage(message);
    setIsHandRaised(true);
  }, [room, userId, userName, isAdmin, sendHandMessage]);

  const lowerHand = useCallback(() => {
    if (!room || !userId || !userName || isAdmin) return;
    if (room.state !== ConnectionState.Connected) return;

    const message: HandRaiseMessage = {
      type: "hand.lower",
      userId,
      userName,
      nonce: crypto.randomUUID(),
      clientTs: Date.now(),
    };

    sendHandMessage(message);
    setIsHandRaised(false);
  }, [room, userId, userName, isAdmin, sendHandMessage]);

  const approveHandRaise = useCallback(
    (targetUserId: string) => {
      if (!room || !isAdmin) return;
      if (room.state !== ConnectionState.Connected) return;

      localQueueRef.current = localQueueRef.current.map((hr) =>
        hr.userId === targetUserId
          ? { ...hr, status: "approved" as const }
          : hr
      );

      const actionMessage: HandActionMessage = {
        type: "hand.approve",
        userId: targetUserId,
      };

      sendHandMessage(actionMessage);
      broadcastQueue();
    },
    [room, isAdmin, broadcastQueue, sendHandMessage]
  );

  const dismissHandRaise = useCallback(
    (targetUserId: string) => {
      if (!room || !isAdmin) return;
      if (room.state !== ConnectionState.Connected) return;

      localQueueRef.current = localQueueRef.current.filter(
        (hr) => hr.userId !== targetUserId
      );

      const actionMessage: HandActionMessage = {
        type: "hand.dismiss",
        userId: targetUserId,
      };

      sendHandMessage(actionMessage);
      broadcastQueue();
    },
    [room, isAdmin, broadcastQueue, sendHandMessage]
  );

  const handReceiverLimiterRef = useRef(new ReceiverRateLimiter());

  // Register text stream handler for incoming hand messages
  useEffect(() => {
    if (!room) return;

    const handler = async (
      reader: { info: { id: string }; readAll: () => Promise<string> },
      participantInfo: { identity: string }
    ) => {
      const senderId = participantInfo.identity ?? "unknown";
      if (!handReceiverLimiterRef.current.shouldAllow(senderId)) return;

      try {
        const text = await reader.readAll();
        if (text.length > 10_000) return;
        const message = JSON.parse(text) as HandMessage;
        const senderIdentity = participantInfo.identity;

        if (message.type === "hand.raise" && isAdmin) {
          const raiseMsg = message as HandRaiseMessage;

          if (senderIdentity && senderIdentity !== raiseMsg.userId) {
            logError(
              "[HandRaises] Raise request identity mismatch, ignoring"
            );
            return;
          }

          if (
            raiseMsg.userName &&
            raiseMsg.userName.length > MESSAGE_LIMITS.MAX_NAME_LENGTH
          ) {
            logError("[HandRaises] userName too long, ignoring");
            return;
          }

          // TTL-based nonce deduplication to prevent replay attacks
          const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
          const now = Date.now();

          // Clean up expired nonces at most once every 60 seconds
          if (
            processedNoncesRef.current.size > 100 &&
            now - lastNoncePruneAtRef.current > 60_000
          ) {
            lastNoncePruneAtRef.current = now;
            for (const [nonce, timestamp] of processedNoncesRef.current) {
              if (now - timestamp > NONCE_TTL_MS) {
                processedNoncesRef.current.delete(nonce);
              }
            }
          }

          // Check if nonce exists and is not expired
          if (processedNoncesRef.current.has(raiseMsg.nonce)) {
            const timestamp = processedNoncesRef.current.get(raiseMsg.nonce)!;
            if (now - timestamp < NONCE_TTL_MS) return; // Duplicate within TTL
          }
          processedNoncesRef.current.set(raiseMsg.nonce, now);

          const existingIndex = localQueueRef.current.findIndex(
            (hr) => hr.userId === raiseMsg.userId
          );

          if (existingIndex === -1) {
            // Resolve userName from LiveKit participant object (JWT-signed)
            // instead of trusting the message payload
            const senderParticipant = senderIdentity
              ? room.remoteParticipants.get(senderIdentity)
              : undefined;
            const resolvedName = senderParticipant?.name || raiseMsg.userName;
            const handRaise: HandRaise = {
              identity: senderIdentity || raiseMsg.userId,
              userId: raiseMsg.userId,
              userName: resolvedName,
              raisedAt: Date.now(),
              status: "pending",
              nonce: raiseMsg.nonce,
            };
            localQueueRef.current.push(handRaise);
            broadcastQueue();
          }
        } else if (message.type === "hand.lower" && isAdmin) {
          const lowerMsg = message as HandRaiseMessage;

          if (senderIdentity && senderIdentity !== lowerMsg.userId) {
            logError(
              "[HandRaises] Lower request identity mismatch, ignoring"
            );
            return;
          }

          localQueueRef.current = localQueueRef.current.filter(
            (hr) => hr.userId !== lowerMsg.userId
          );
          broadcastQueue();
        } else if (message.type === "hand.queue" && !isAdmin) {
          const queueMsg = message as HandQueueMessage;

          if (!senderIdentity) {
            logError(
              "[HandRaises] Queue update without sender identity, ignoring"
            );
            return;
          }
          const senderParticipant =
            senderIdentity === room.localParticipant.identity
              ? room.localParticipant
              : room.remoteParticipants.get(senderIdentity);
          if (!hasAdminGrant(senderParticipant)) {
            logError(
              "[HandRaises] Queue update from non-admin grant holder, ignoring"
            );
            return;
          }

          if (queueMsg.seq > queueSeqRef.current) {
            setHandRaiseQueue(queueMsg.queue);
            queueSeqRef.current = queueMsg.seq;

            if (userId) {
              const myHandRaise = queueMsg.queue.find(
                (hr) => hr.userId === userId
              );
              setIsHandRaised(
                !!myHandRaise && myHandRaise.status === "pending"
              );
            }
          }
        } else if (
          message.type === "hand.approve" ||
          message.type === "hand.dismiss"
        ) {
          // Reject messages without sender identity
          if (!senderIdentity) {
            logError("[HandRaises] Action without sender identity, ignoring");
            return;
          }
          // Verify sender has admin grants before processing
          const senderParticipant =
            senderIdentity === room.localParticipant.identity
              ? room.localParticipant
              : room.remoteParticipants.get(senderIdentity);
          if (!hasAdminGrant(senderParticipant)) {
            logError(
              "[HandRaises] Action from non-admin grant holder, ignoring"
            );
            return;
          }
          const actionMsg = message as HandActionMessage;
          if (actionMsg.userId === userId) {
            setIsHandRaised(false);
          }
        }
      } catch (error) {
        logError("[HandRaises] Failed to parse message:", error);
      }
    };

    room.registerTextStreamHandler(LIVEKIT_TOPICS.HAND, handler);

    return () => {
      room.unregisterTextStreamHandler(LIVEKIT_TOPICS.HAND);
    };
  }, [room, isAdmin, userId, broadcastQueue]);

  // Handle participant disconnect - remove their hand raises (host only)
  useEffect(() => {
    if (!room || !isAdmin) return;

    const handleParticipantDisconnected = (participant: RemoteParticipant) => {
      const prevLength = localQueueRef.current.length;
      localQueueRef.current = localQueueRef.current.filter(
        (hr) => hr.identity !== participant.identity
      );

      if (localQueueRef.current.length !== prevLength) {
        broadcastQueue();
      }
    };

    room.on("participantDisconnected", handleParticipantDisconnected);

    return () => {
      room.off("participantDisconnected", handleParticipantDisconnected);
    };
  }, [room, isAdmin, broadcastQueue]);

  return {
    handRaiseQueue,
    isHandRaised,
    raiseHand,
    lowerHand,
    approveHandRaise,
    dismissHandRaise,
  };
}
