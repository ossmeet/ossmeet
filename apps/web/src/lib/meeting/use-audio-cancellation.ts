import type { Room } from "livekit-client";
import { useAudioCancellation as _useAudioCancellation } from "@whiteboard/use-audio-cancellation";

export type AudioCancellationStatus = "native" | "starting" | "active" | "fallback" | "unsupported";

export interface UseAudioCancellationReturn {
  hasNoiseFilterFeature: boolean;
  canToggleNoiseFilter: boolean;
  isNoiseFilterEnabled: boolean;
  isNoiseFilterPending: boolean;
  status: AudioCancellationStatus;
  lastError: string | null;
  setNoiseFilterEnabled: (enabled: boolean) => Promise<void>;
}

export function useAudioCancellation(
  room: Room | undefined,
  isMicOn: boolean,
): UseAudioCancellationReturn {
  return _useAudioCancellation(room, isMicOn);
}
