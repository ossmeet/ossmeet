import type { LocalTrack, Room } from "livekit-client";

function stopMediaStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

export function stopMediaElementsInScope(scope: HTMLElement | null) {
  if (typeof document === "undefined") return;
  const root = scope ?? document;
  root
    .querySelectorAll<HTMLVideoElement | HTMLAudioElement>("video, audio")
    .forEach((element) => {
      if (element.srcObject && element.srcObject instanceof MediaStream) {
        stopMediaStream(element.srcObject);
        element.srcObject = null;
      }
    });
}

export async function stopAllLocalTracks(
  room: Room,
  localTracks: Set<LocalTrack>
): Promise<void> {
  const localParticipant = room.localParticipant;

  await Promise.all([
    localParticipant.setCameraEnabled(false).catch(() => undefined),
    localParticipant.setMicrophoneEnabled(false).catch(() => undefined),
    localParticipant.setScreenShareEnabled(false).catch(() => undefined),
  ]);

  localParticipant.trackPublications.forEach((publication) => {
    if (publication.track) {
      publication.track.stop();
      if (publication.track.mediaStreamTrack) {
        publication.track.mediaStreamTrack.stop();
      }
    }
  });

  localTracks.forEach((track) => {
    try {
      track.stop();
      if (track.mediaStreamTrack) {
        track.mediaStreamTrack.stop();
      }
    } catch {
      // Track may already be stopped.
    }
  });
  localTracks.clear();

  await new Promise((resolve) => setTimeout(resolve, 100));
}

export function stopAllLocalTracksSync(
  room: Room,
  localTracks: Set<LocalTrack>
) {
  const localParticipant = room.localParticipant;

  localParticipant.setCameraEnabled(false).catch(() => undefined);
  localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
  localParticipant.setScreenShareEnabled(false).catch(() => undefined);

  localParticipant.trackPublications.forEach((publication) => {
    if (publication.track) {
      publication.track.stop();
      if (publication.track.mediaStreamTrack) {
        publication.track.mediaStreamTrack.stop();
      }
    }
  });

  localTracks.forEach((track) => {
    try {
      track.stop();
      if (track.mediaStreamTrack) {
        track.mediaStreamTrack.stop();
      }
    } catch {
      // Track may already be stopped.
    }
  });
  localTracks.clear();
}
