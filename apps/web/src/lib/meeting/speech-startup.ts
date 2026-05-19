import * as React from "react";
import { ConnectionState, RoomEvent, Track, type Room } from "livekit-client";
import { getPlatformInfo, type PlatformInfo } from "@/lib/platform";
import { isSpeechWarmUpDone, warmUpSpeechRecognition } from "./speech-warmup";

const IPADOS_SPEECH_STARTUP_DELAY_MS = 4_000;

export function getSpeechRecognitionStartupDelayMs(
  platform: PlatformInfo = getPlatformInfo(),
) {
  return platform.os === "ipados" ? IPADOS_SPEECH_STARTUP_DELAY_MS : 0;
}

function hasSettledLocalMicrophone(room: Room | undefined, isMicOn: boolean) {
  if (!room || room.state !== ConnectionState.Connected || !isMicOn) return false;
  const publication = room.localParticipant.getTrackPublication(
    Track.Source.Microphone,
  );
  const mediaTrack = publication?.track?.mediaStreamTrack;
  return Boolean(
    publication &&
      mediaTrack &&
      mediaTrack.readyState === "live" &&
      mediaTrack.enabled &&
      !mediaTrack.muted,
  );
}

export function useSpeechStartupReady(
  room: Room | undefined,
  isMicOn: boolean,
  canStartSpeech: boolean,
) {
  const [ready, setReady] = React.useState(false);
  const startupDelayMs = React.useMemo(
    () => getSpeechRecognitionStartupDelayMs(),
    [],
  );
  const [warmupDone, setWarmupDone] = React.useState(isSpeechWarmUpDone);

  React.useEffect(() => {
    if (warmupDone) return;
    let cancelled = false;
    warmUpSpeechRecognition().then(() => {
      if (!cancelled) setWarmupDone(true);
    });
    return () => { cancelled = true; };
  }, [warmupDone]);

  React.useEffect(() => {
    let cancelled = false;
    let rafId: number | null = null;
    let idleId: number | null = null;
    let delayId: number | null = null;
    let mediaTrack: MediaStreamTrack | null = null;

    const clearPending = () => {
      if (delayId !== null) {
        window.clearTimeout(delayId);
        delayId = null;
      }
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (
        idleId !== null &&
        typeof window.cancelIdleCallback === "function"
      ) {
        window.cancelIdleCallback(idleId);
        idleId = null;
      }
    };

    const isBaseReady = () =>
      canStartSpeech &&
      warmupDone &&
      document.visibilityState === "visible" &&
      hasSettledLocalMicrophone(room, isMicOn);

    const markReadyAfterBrowserSettles = () => {
      clearPending();
      setReady(false);
      if (!isBaseReady()) return;

      const complete = () => {
        if (!cancelled && isBaseReady()) setReady(true);
      };

      const scheduleComplete = () => {
        if (typeof window.requestIdleCallback === "function") {
          idleId = window.requestIdleCallback(complete);
          return;
        }

        rafId = window.requestAnimationFrame(() => {
          rafId = window.requestAnimationFrame(complete);
        });
      };

      if (startupDelayMs > 0) {
        delayId = window.setTimeout(scheduleComplete, startupDelayMs);
        return;
      }

      scheduleComplete();
    };

    const syncMediaTrackListener = () => {
      mediaTrack?.removeEventListener("mute", markReadyAfterBrowserSettles);
      mediaTrack?.removeEventListener("unmute", markReadyAfterBrowserSettles);
      mediaTrack?.removeEventListener("ended", markReadyAfterBrowserSettles);
      mediaTrack =
        room?.localParticipant.getTrackPublication(Track.Source.Microphone)
          ?.track?.mediaStreamTrack ?? null;
      mediaTrack?.addEventListener("mute", markReadyAfterBrowserSettles);
      mediaTrack?.addEventListener("unmute", markReadyAfterBrowserSettles);
      mediaTrack?.addEventListener("ended", markReadyAfterBrowserSettles);
    };

    syncMediaTrackListener();
    markReadyAfterBrowserSettles();

    document.addEventListener("visibilitychange", markReadyAfterBrowserSettles);
    room?.on(RoomEvent.Connected, markReadyAfterBrowserSettles);
    room?.on(RoomEvent.Reconnected, markReadyAfterBrowserSettles);
    room?.on(RoomEvent.Reconnecting, markReadyAfterBrowserSettles);
    room?.on(RoomEvent.Disconnected, markReadyAfterBrowserSettles);
    room?.on(RoomEvent.LocalTrackPublished, syncMediaTrackListener);
    room?.on(RoomEvent.LocalTrackUnpublished, syncMediaTrackListener);
    room?.on(RoomEvent.LocalTrackPublished, markReadyAfterBrowserSettles);
    room?.on(RoomEvent.LocalTrackUnpublished, markReadyAfterBrowserSettles);

    return () => {
      cancelled = true;
      clearPending();
      document.removeEventListener(
        "visibilitychange",
        markReadyAfterBrowserSettles,
      );
      mediaTrack?.removeEventListener("mute", markReadyAfterBrowserSettles);
      mediaTrack?.removeEventListener("unmute", markReadyAfterBrowserSettles);
      mediaTrack?.removeEventListener("ended", markReadyAfterBrowserSettles);
      room?.off(RoomEvent.Connected, markReadyAfterBrowserSettles);
      room?.off(RoomEvent.Reconnected, markReadyAfterBrowserSettles);
      room?.off(RoomEvent.Reconnecting, markReadyAfterBrowserSettles);
      room?.off(RoomEvent.Disconnected, markReadyAfterBrowserSettles);
      room?.off(RoomEvent.LocalTrackPublished, syncMediaTrackListener);
      room?.off(RoomEvent.LocalTrackUnpublished, syncMediaTrackListener);
      room?.off(RoomEvent.LocalTrackPublished, markReadyAfterBrowserSettles);
      room?.off(RoomEvent.LocalTrackUnpublished, markReadyAfterBrowserSettles);
    };
  }, [canStartSpeech, isMicOn, room, startupDelayMs, warmupDone]);

  return ready;
}
