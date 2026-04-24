import { useEffect, useState, useCallback } from "react";
import type { Room, RemoteParticipant, Participant } from "livekit-client";
import { RoomEvent } from "livekit-client";
import { hasAdminGrant } from "./participant-grants";
import type { MEETING_ROLES } from "@ossmeet/shared";

type MeetingRole = (typeof MEETING_ROLES)[number];

/**
 * Presence state for a participant
 */
export interface ParticipantPresence {
  identity: string;
  userId: string;
  userName: string;
  role: MeetingRole;
  joinedAt: number;
  isActive: boolean;
  isCameraEnabled?: boolean;
  isMicrophoneEnabled?: boolean;
}

/**
 * Hook for tracking participant presence via LiveKit's native participant events
 */
export function useLiveKitPresence(room: Room | undefined) {
  const [participants, setParticipants] = useState<ParticipantPresence[]>([]);
  const [hostPresent, setHostPresent] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);

  const toPresence = useCallback(
    (participant: Participant): ParticipantPresence => {
      let role: MeetingRole = "participant";
      if (hasAdminGrant(participant)) {
        role = "host";
      } else {
        try {
          const metadata = JSON.parse(participant.metadata || "{}");
          if (metadata.role === "guest") role = "guest";
        } catch { /* default to participant */ }
      }
      return {
        identity: participant.identity,
        userId: participant.identity,
        userName: participant.name || participant.identity,
        role,
        joinedAt: participant.joinedAt?.getTime() || Date.now(),
        isActive: true,
        isCameraEnabled: participant.isCameraEnabled,
        isMicrophoneEnabled: participant.isMicrophoneEnabled,
      };
    },
    []
  );

  const updateParticipants = useCallback(() => {
    if (!room) {
      setParticipants([]);
      setHostPresent(false);
      setParticipantCount(0);
      return;
    }

    const allParticipants: ParticipantPresence[] = [];

    if (room.localParticipant) {
      allParticipants.push(toPresence(room.localParticipant));
    }

    for (const participant of room.remoteParticipants.values()) {
      allParticipants.push(toPresence(participant));
    }

    const hasHost = allParticipants.some((p) => p.role === "host");

    setParticipants(allParticipants);
    setHostPresent(hasHost);
    setParticipantCount(allParticipants.length);
  }, [room, toPresence]);

  useEffect(() => {
    if (!room) {
      setParticipants([]);
      setHostPresent(false);
      setParticipantCount(0);
      return;
    }

    updateParticipants();

    const handleParticipantConnected = (_participant: RemoteParticipant) => {
      updateParticipants();
    };

    const handleParticipantDisconnected = (_participant: RemoteParticipant) => {
      updateParticipants();
    };

    const handleParticipantMetadataChanged = () => {
      updateParticipants();
    };

    // Throttle high-frequency events via rAF
    const rafPending = { current: false };
    let rafId: number | null = null;
    const throttledUpdate = () => {
      if (rafPending.current) return;
      rafPending.current = true;
      rafId = requestAnimationFrame(() => {
        rafPending.current = false;
        rafId = null;
        updateParticipants();
      });
    };

    const handleTrackMuted = () => throttledUpdate();
    const handleTrackUnmuted = () => throttledUpdate();

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    room.on(
      RoomEvent.ParticipantMetadataChanged,
      handleParticipantMetadataChanged
    );
    room.on(RoomEvent.TrackMuted, handleTrackMuted);
    room.on(RoomEvent.TrackUnmuted, handleTrackUnmuted);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(
        RoomEvent.ParticipantDisconnected,
        handleParticipantDisconnected
      );
      room.off(
        RoomEvent.ParticipantMetadataChanged,
        handleParticipantMetadataChanged
      );
      room.off(RoomEvent.TrackMuted, handleTrackMuted);
      room.off(RoomEvent.TrackUnmuted, handleTrackUnmuted);
    };
  }, [room, updateParticipants]);

  return {
    participants,
    hostPresent,
    participantCount,
  };
}
