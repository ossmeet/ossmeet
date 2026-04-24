import * as React from "react";
import {
  ConnectionState,
  RoomEvent,
  type Room,
  type LocalTrack,
  type LocalTrackPublication,
} from "livekit-client";
import {
  stopAllLocalTracks,
  stopAllLocalTracksSync,
  stopMediaElementsInScope,
} from "@/lib/media-cleanup";

interface MeetingLifecycleReturn {
  roomInstance: Room | undefined;
  mediaScopeRef: React.RefObject<HTMLDivElement | null>;
  currentUserId: string;
  currentUserName: string;
  connectionQuality: "excellent" | "good" | "poor";
  handleRoomUpdate: (room: Room | undefined) => void;
  disconnectRoomNow: () => Promise<void>;
}

export function useMeetingLifecycle(): MeetingLifecycleReturn {
  const roomRef = React.useRef<Room | undefined>(undefined);
  const [roomInstance, setRoomInstance] = React.useState<Room | undefined>(undefined);
  const localTracksRef = React.useRef<Set<LocalTrack>>(new Set());
  const mediaScopeRef = React.useRef<HTMLDivElement | null>(null);
  const deferredCleanupRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [currentUserId, setCurrentUserId] = React.useState("");
  const [currentUserName, setCurrentUserName] = React.useState("");
  const [connectionQuality, setConnectionQuality] = React.useState<"excellent" | "good" | "poor">("excellent");

  // Sync room context from LiveKitRoom to parent refs
  const handleRoomUpdate = React.useCallback((room: Room | undefined) => {
    roomRef.current = room;
    setRoomInstance(room);
  }, []);

  const disconnectRoomNow = React.useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = undefined;
    setRoomInstance(undefined);
    setCurrentUserId("");
    setCurrentUserName("");
    setConnectionQuality("excellent");

    if (room) {
      await stopAllLocalTracks(room, localTracksRef.current).catch(() => undefined);
      await room.disconnect(true).catch(() => undefined);
    }

    stopMediaElementsInScope(mediaScopeRef.current);
  }, []);

  React.useEffect(() => {
    if (roomInstance) return;
    setCurrentUserId("");
    setCurrentUserName("");
    setConnectionQuality("excellent");
  }, [roomInstance]);

  // Extract identity from LiveKit once connected
  React.useEffect(() => {
    if (!roomInstance) return;

    const extractIdentity = () => {
      const lp = roomInstance.localParticipant;
      if (lp.identity) {
        setCurrentUserId(lp.identity);
        setCurrentUserName(lp.name || lp.identity);
      }
    };

    extractIdentity();

    if (roomInstance.state === ConnectionState.Connected) return;
    roomInstance.on(RoomEvent.Connected, extractIdentity);
    return () => {
      roomInstance.off(RoomEvent.Connected, extractIdentity);
    };
  }, [roomInstance]);

  // Connection quality monitoring
  React.useEffect(() => {
    if (!roomInstance) return;

    const updateConnectionQuality = () => {
      const quality = roomInstance.localParticipant.connectionQuality;
      if (quality === "excellent") setConnectionQuality("excellent");
      else if (quality === "good") setConnectionQuality("good");
      else setConnectionQuality("poor");
    };

    updateConnectionQuality();

    roomInstance.on(RoomEvent.ConnectionQualityChanged, updateConnectionQuality);
    return () => {
      roomInstance.off(RoomEvent.ConnectionQualityChanged, updateConnectionQuality);
    };
  }, [roomInstance]);

  // Track local tracks for cleanup
  React.useEffect(() => {
    if (!roomInstance) return;

    localTracksRef.current.clear();

    const handlePublished = (publication: LocalTrackPublication) => {
      if (publication.track) {
        localTracksRef.current.add(publication.track);
      }
    };

    const handleUnpublished = (publication: LocalTrackPublication) => {
      if (publication.track) {
        localTracksRef.current.delete(publication.track);
      }
    };

    roomInstance.on(RoomEvent.LocalTrackPublished, handlePublished);
    roomInstance.on(RoomEvent.LocalTrackUnpublished, handleUnpublished);

    roomInstance.localParticipant.trackPublications.forEach((pub) => {
      if (pub.track) localTracksRef.current.add(pub.track as LocalTrack);
    });

    return () => {
      roomInstance.off(RoomEvent.LocalTrackPublished, handlePublished);
      roomInstance.off(RoomEvent.LocalTrackUnpublished, handleUnpublished);
    };
  }, [roomInstance]);

  // Cleanup on unmount
  React.useEffect(() => {
    if (deferredCleanupRef.current) {
      clearTimeout(deferredCleanupRef.current);
      deferredCleanupRef.current = null;
    }

    return () => {
      // Defer cleanup by one tick so React DEV strict-mode's simulated unmount
      // doesn't tear down an in-flight initial connection.
      deferredCleanupRef.current = setTimeout(() => {
        deferredCleanupRef.current = null;
        if (roomRef.current) {
          stopAllLocalTracksSync(roomRef.current, localTracksRef.current);
          roomRef.current.disconnect(true).catch(() => {});
        }
        stopMediaElementsInScope(mediaScopeRef.current);
      }, 0);
    };
  }, []);

  return {
    roomInstance,
    mediaScopeRef,
    currentUserId,
    currentUserName,
    connectionQuality,
    handleRoomUpdate,
    disconnectRoomNow,
  };
}
