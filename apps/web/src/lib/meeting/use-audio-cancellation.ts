import * as React from "react";
import {
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type Room,
} from "livekit-client";

type AudioCancellationStatus = "native" | "starting" | "active" | "fallback" | "unsupported";

interface UseAudioCancellationReturn {
  canToggleNoiseFilter: boolean;
  isNoiseFilterEnabled: boolean;
  isNoiseFilterPending: boolean;
  status: AudioCancellationStatus;
  lastError: string | null;
  setNoiseFilterEnabled: (enabled: boolean) => Promise<void>;
}

function getMicrophoneTrack(room: Room | undefined): LocalAudioTrack | null {
  const publication = room?.localParticipant.getTrackPublication(Track.Source.Microphone);
  const track = publication?.track;
  if (typeof MediaStreamTrack === "undefined") return null;
  return track &&
    typeof track === "object" &&
    (track as { kind?: unknown }).kind === Track.Kind.Audio &&
    (track as { mediaStreamTrack?: unknown }).mediaStreamTrack instanceof MediaStreamTrack
    ? (track as LocalAudioTrack)
    : null;
}

async function applyNativeConstraints(track: LocalAudioTrack | null, suppress: boolean) {
  const mediaTrack = track?.mediaStreamTrack;
  if (!mediaTrack || mediaTrack.readyState !== "live") return;
  await mediaTrack.applyConstraints({
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: suppress,
  });
}

export function useAudioCancellation(room: Room | undefined, isMicOn: boolean): UseAudioCancellationReturn {
  const [trackRevision, setTrackRevision] = React.useState(0);

  React.useEffect(() => {
    if (!room) return;
    const bump = () => setTrackRevision((v) => v + 1);
    room.on(RoomEvent.LocalTrackPublished, bump);
    room.on(RoomEvent.LocalTrackUnpublished, bump);
    bump();
    return () => {
      room.off(RoomEvent.LocalTrackPublished, bump);
      room.off(RoomEvent.LocalTrackUnpublished, bump);
    };
  }, [room]);

  React.useEffect(() => {
    if (!room || !isMicOn) return;
    const track = getMicrophoneTrack(room);
    void applyNativeConstraints(track, true).catch(() => {});
  }, [room, isMicOn, trackRevision]);

  const [isNoiseFilterEnabled, setIsNoiseFilterEnabled] = React.useState(true);

  const setNoiseFilterEnabled = React.useCallback(async (value: boolean) => {
    const track = getMicrophoneTrack(room);
    await applyNativeConstraints(track, value).catch(() => {});
    setIsNoiseFilterEnabled(value);
  }, [room]);

  return {
    canToggleNoiseFilter: true,
    isNoiseFilterEnabled,
    isNoiseFilterPending: false,
    status: "native",
    lastError: null,
    setNoiseFilterEnabled,
  };
}
