import * as React from "react";
import { Track, createLocalVideoTrack, type Room, type LocalVideoTrack } from "livekit-client";
import { logError } from "@/lib/logger-client";
import { getCameraCaptureDefaults, getCameraPublishDefaults, isSafariOrIOS } from "./media-quality";
import { pickNativeVideoDevice } from "./device-selection";
import type { useToast } from "@/components/ui/toast";

export function useMeetingCamera({
  roomInstance,
  isCameraOn,
  addToast,
}: {
  roomInstance: Room | undefined;
  isCameraOn: boolean;
  addToast: ReturnType<typeof useToast>["add"];
}) {
  const [videoDevices, setVideoDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [currentVideoDeviceId, setCurrentVideoDeviceId] = React.useState<string | undefined>(undefined);
  // Ref keeps the latest device ID available inside refreshVideoDevices without
  // making it a dep — preventing spurious re-creations on every device switch.
  const currentVideoDeviceIdRef = React.useRef<string | undefined>(undefined);

  const refreshVideoDevices = React.useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const uniqueDevices = devices
        .filter((d) => d.kind === "videoinput")
        .filter((d, i, arr) => arr.findIndex((x) => x.deviceId === d.deviceId) === i);
      setVideoDevices(uniqueDevices);
      if (!currentVideoDeviceIdRef.current && uniqueDevices.length > 0) {
        const best = pickNativeVideoDevice(uniqueDevices) ?? uniqueDevices[0];
        currentVideoDeviceIdRef.current = best.deviceId;
        setCurrentVideoDeviceId(best.deviceId);
      }
    } catch (err) {
      logError("[Meeting] Failed to enumerate video devices:", err);
    }
  }, []);

  React.useEffect(() => {
    refreshVideoDevices();
  }, [refreshVideoDevices]);

  React.useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => {
      refreshVideoDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshVideoDevices]);

  // Refresh devices when camera is turned on
  React.useEffect(() => {
    if (isCameraOn) {
      const timeout = setTimeout(() => {
        refreshVideoDevices();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [isCameraOn, refreshVideoDevices]);

  const handleSelectVideoDevice = React.useCallback(
    async (deviceId: string) => {
      if (!roomInstance) return;
      try {
        // On Safari/iOS, in-place device switching (switchActiveDevice) can
        // leave the H.264 encoder in a half-reconfigured state — the
        // publisher emits frames under one profile-level-id while the SFU
        // still expects the previous one. The symptom is black video on
        // remote subscribers, especially Firefox. Republishing a fresh
        // local track forces a clean codec/SSRC negotiation and a fresh
        // keyframe.
        if (isSafariOrIOS()) {
          const lp = roomInstance.localParticipant;
          const pub = lp.getTrackPublication(Track.Source.Camera);
          const oldTrack = pub?.track as LocalVideoTrack | undefined;

          if (oldTrack) {
            await lp.unpublishTrack(oldTrack, true);
            oldTrack.stop();
          }

          const newTrack = await createLocalVideoTrack({
            ...getCameraCaptureDefaults(),
            deviceId,
          });

          await lp.publishTrack(newTrack, {
            source: Track.Source.Camera,
            ...getCameraPublishDefaults(),
          });
        } else {
          await roomInstance.switchActiveDevice("videoinput", deviceId, true);
        }
        currentVideoDeviceIdRef.current = deviceId;
        setCurrentVideoDeviceId(deviceId);
      } catch (err) {
        logError("[Meeting] Failed to switch camera:", err);
        addToast({
          title: "Camera switch failed",
          description: "Could not switch to the selected camera. Please try again.",
          data: { variant: "error" },
        });
      }
    },
    [roomInstance, addToast],
  );

  return {
    videoDevices,
    currentVideoDeviceId,
    handleSelectVideoDevice,
    refreshVideoDevices,
  };
}
