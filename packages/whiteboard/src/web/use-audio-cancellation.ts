import * as React from "react";
import type { Room } from "livekit-client";

type AudioCancellationStatus =
  | "native"
  | "starting"
  | "active"
  | "fallback"
  | "unsupported";

export interface UseAudioCancellationReturn {
  hasNoiseFilterFeature: boolean;
  canToggleNoiseFilter: boolean;
  isNoiseFilterEnabled: boolean;
  isNoiseFilterPending: boolean;
  status: AudioCancellationStatus;
  lastError: string | null;
  setNoiseFilterEnabled: (enabled: boolean) => Promise<void>;
}

const noop = async (_enabled: boolean): Promise<void> => {};

export function useAudioCancellation(
  _room: Room | undefined,
  _isMicOn: boolean,
): UseAudioCancellationReturn {
  return React.useMemo(
    () => ({
      hasNoiseFilterFeature: false,
      canToggleNoiseFilter: false,
      isNoiseFilterEnabled: false,
      isNoiseFilterPending: false,
      status: "native" as AudioCancellationStatus,
      lastError: null,
      setNoiseFilterEnabled: noop,
    }),
    [],
  );
}
