import { useEffect, useCallback, useState, useRef } from "react";
import type { Room, RemoteParticipant } from "livekit-client";
import { ConnectionState, RoomEvent } from "livekit-client";
import { logError } from "@/lib/logger-client";
import { isExpectedClosedPublishError } from "./livekit-helpers";
import { LIVEKIT_TOPICS } from "./constants";
import { hasAdminGrant } from "./participant-grants";
import { ReceiverRateLimiter } from "./receiver-rate-limiter";

interface ScreenShareRequest {
  type: "screen_share.request";
  userId: string;
  userName: string;
}

interface ScreenShareResponse {
  type: "screen_share.approve" | "screen_share.deny";
  userId: string;
}

type ScreenShareMessage = ScreenShareRequest | ScreenShareResponse;

export interface PendingScreenShareRequest {
  identity: string;
  userId: string;
  userName: string;
  requestedAt: number;
}

export function useLiveKitScreenShare(
  room: Room | undefined,
  userId?: string,
  userName?: string,
  isAdmin = false
) {
  const [pendingRequests, setPendingRequests] = useState<PendingScreenShareRequest[]>([]);
  const [requestState, setRequestState] = useState<"idle" | "pending" | "approved" | "denied">("idle");
  const limiterRef = useRef(new ReceiverRateLimiter(5, 1000));

  const publishMessage = useCallback(
    (msg: ScreenShareMessage, destinationIdentities?: string[]) => {
      if (!room || room.state !== ConnectionState.Connected) return;
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(msg));
      const opts: { reliable: true; topic: string; destinationIdentities?: string[] } = {
        reliable: true,
        topic: LIVEKIT_TOPICS.SCREEN_SHARE,
      };
      if (destinationIdentities && destinationIdentities.length > 0) {
        opts.destinationIdentities = destinationIdentities;
      }
      void room.localParticipant
        .publishData(data, opts)
        .catch((err) => {
          if (isExpectedClosedPublishError(err)) return;
          logError("[ScreenShare] publishData failed:", err);
        });
    },
    [room]
  );

  const requestScreenShare = useCallback(() => {
    if (!userId || !userName || isAdmin) return;
    setRequestState("pending");
    publishMessage({ type: "screen_share.request", userId, userName });
  }, [userId, userName, isAdmin, publishMessage]);

  const cancelRequest = useCallback(() => {
    setRequestState("idle");
  }, []);

  const approveRequest = useCallback(
    (targetIdentity: string) => {
      if (!isAdmin) return;
      setPendingRequests((prev) => prev.filter((r) => r.identity !== targetIdentity));
      publishMessage(
        { type: "screen_share.approve", userId: targetIdentity },
        [targetIdentity]
      );
    },
    [isAdmin, publishMessage]
  );

  const denyRequest = useCallback(
    (targetIdentity: string) => {
      if (!isAdmin) return;
      setPendingRequests((prev) => prev.filter((r) => r.identity !== targetIdentity));
      publishMessage(
        { type: "screen_share.deny", userId: targetIdentity },
        [targetIdentity]
      );
    },
    [isAdmin, publishMessage]
  );

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string
    ) => {
      if (topic !== LIVEKIT_TOPICS.SCREEN_SHARE) return;

      const senderId = participant?.identity ?? "unknown";
      if (!limiterRef.current.shouldAllow(senderId)) return;

      try {
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload)) as ScreenShareMessage;
        const senderIdentity = participant?.identity;

        if (message.type === "screen_share.request" && isAdmin) {
          if (senderIdentity && senderIdentity !== message.userId) return;

          const senderParticipant = senderIdentity
            ? room.remoteParticipants.get(senderIdentity)
            : undefined;
          const resolvedName = senderParticipant?.name || (message as ScreenShareRequest).userName;

          setPendingRequests((prev) => {
            if (prev.some((r) => r.identity === (senderIdentity || message.userId))) return prev;
            return [
              ...prev,
              {
                identity: senderIdentity || message.userId,
                userId: message.userId,
                userName: resolvedName,
                requestedAt: Date.now(),
              },
            ];
          });
        } else if (
          (message.type === "screen_share.approve" || message.type === "screen_share.deny") &&
          !isAdmin
        ) {
          if (!senderIdentity) return;
          const senderParticipant =
            senderIdentity === room.localParticipant.identity
              ? room.localParticipant
              : room.remoteParticipants.get(senderIdentity);
          if (!hasAdminGrant(senderParticipant)) return;

          if ((message as ScreenShareResponse).userId === room.localParticipant.identity) {
            setRequestState(message.type === "screen_share.approve" ? "approved" : "denied");
          }
        }
      } catch (error) {
        logError("[ScreenShare] Failed to parse message:", error);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, isAdmin]);

  // Clean up requests from disconnected participants
  useEffect(() => {
    if (!room || !isAdmin) return;
    const handleDisconnected = (participant: RemoteParticipant) => {
      setPendingRequests((prev) => prev.filter((r) => r.identity !== participant.identity));
    };
    room.on(RoomEvent.ParticipantDisconnected, handleDisconnected);
    return () => {
      room.off(RoomEvent.ParticipantDisconnected, handleDisconnected);
    };
  }, [room, isAdmin]);

  return {
    pendingRequests,
    requestState,
    requestScreenShare,
    cancelRequest,
    approveRequest,
    denyRequest,
  };
}
