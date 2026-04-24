import { useCallback, useEffect, useRef, useState } from "react";
import { Track, RoomEvent, type Room, type LocalVideoTrack, type LocalTrackPublication } from "livekit-client";
import type { BackgroundProcessorWrapper } from "@livekit/track-processors";
import { logError, logInfo } from "@/lib/logger-client";

export type BackgroundMode = "none" | "blur" | "image";

interface BackgroundEffectState {
  mode: BackgroundMode;
  imagePath: string | null;
  isSupported: boolean;
  isProcessing: boolean;
  lastError: string | null;
}

const BG_STORAGE_KEY = "ossmeet.bg-effect.v1";

/**
 * Self-hosted MediaPipe WASM fileset.  The files are copied from
 * `@mediapipe/tasks-vision/wasm/` into `public/wasm/mediapipe/` so they are
 * served from the same origin, avoiding cross-origin script-load failures
 * that occur when the CDN URL is blocked by CSP or ad-blockers.
 */
const MEDIAPIPE_ASSET_PATH = "/wasm/mediapipe";

const PRESET_BACKGROUNDS = [
  "/images/backgrounds/beach.svg",
  "/images/backgrounds/mountains.svg",
  "/images/backgrounds/office.svg",
  "/images/backgrounds/gradient.svg",
  "/images/backgrounds/library.svg",
  "/images/backgrounds/space.svg",
  "/images/backgrounds/cozy-room.svg",
  "/images/backgrounds/forest.svg",
  "/images/backgrounds/city-night.svg",
  "/images/backgrounds/cafe.svg",
  "/images/backgrounds/sunset.svg",
  "/images/backgrounds/abstract-wave.svg",
  "/images/backgrounds/conference.svg",
] as const;

export { PRESET_BACKGROUNDS };

export function loadBackgroundPreference(): { mode: BackgroundMode; imagePath: string | null } {
  if (typeof window === "undefined") return { mode: "none", imagePath: null };
  try {
    const raw = window.localStorage.getItem(BG_STORAGE_KEY);
    if (!raw) return { mode: "none", imagePath: null };
    const parsed = JSON.parse(raw);
    return {
      mode: parsed?.mode === "blur" || parsed?.mode === "image" ? parsed.mode : "none",
      imagePath: typeof parsed?.imagePath === "string" ? parsed.imagePath : null,
    };
  } catch {
    return { mode: "none", imagePath: null };
  }
}

export function saveBackgroundPreference(mode: BackgroundMode, imagePath: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BG_STORAGE_KEY, JSON.stringify({ mode, imagePath }));
  } catch {
    // ignore
  }
}

export async function destroyBackgroundProcessor(processor: BackgroundProcessorWrapper | null) {
  if (!processor || typeof (processor as { destroy?: unknown }).destroy !== "function") return;
  try {
    await (processor as { destroy: () => Promise<void> | void }).destroy();
  } catch {
    // Best-effort cleanup only; track shutdown should continue.
  }
}

/**
 * Extracts a human-readable message from errors thrown during processor
 * initialisation. MediaPipe WASM / model load failures surface as plain DOM
 * Events rather than Error instances, so `String(err)` yields the useless
 * "[object Event]". This helper digs into the Event's target to find a URL
 * or falls back to a generic description.
 */
export function describeProcessorError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    // DOM ErrorEvent carries a message directly
    if (typeof e.message === "string" && e.message) return e.message;
    // Generic Event from a failed <script> / fetch – target.src has the URL
    if (e.target && typeof e.target === "object") {
      const src = (e.target as Record<string, unknown>).src;
      if (typeof src === "string") return `Failed to load resource: ${src}`;
    }
    if (typeof e.type === "string") return `Load error (${e.type})`;
  }
  return String(err);
}

/**
 * Lazily imports @livekit/track-processors and caches the module.
 * This keeps the ~2MB MediaPipe WASM out of the main bundle.
 */
let trackProcessorsPromise: Promise<typeof import("@livekit/track-processors")> | null = null;
function getTrackProcessors() {
  if (!trackProcessorsPromise) {
    trackProcessorsPromise = import("@livekit/track-processors").catch((err) => {
      // Reset so retries can attempt the import again (don't cache failures permanently)
      trackProcessorsPromise = null;
      throw err;
    });
  }
  return trackProcessorsPromise;
}

/**
 * Hook to manage background blur / virtual background on the local camera track.
 *
 * Uses a single `BackgroundProcessor` instance and calls `switchTo()` to avoid
 * visual flicker when changing modes.
 */
export function useBackgroundEffect(room: Room | undefined) {
  const [mode, setModeState] = useState<BackgroundMode>(() => loadBackgroundPreference().mode);
  const [imagePath, setImagePathState] = useState<string | null>(() => loadBackgroundPreference().imagePath);
  const [isSupported, setIsSupported] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Refs that mirror state — read inside async callbacks and event handlers
  // to avoid stale-closure reads while the UI still drives from proper state.
  const modeRef = useRef<BackgroundMode>(mode);
  const imagePathRef = useRef<string | null>(imagePath);

  // Keep a stable ref to the processor instance
  const processorRef = useRef<BackgroundProcessorWrapper | null>(null);
  // Track whether we've checked support
  const supportCheckedRef = useRef(false);
  // Store the timer ID so it can be cleared on unmount or track churn
  const reapplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonically increasing ID — each applyEffect call captures the current
  // value.  When the async work finishes, if the ID has moved on it means a
  // newer call superseded this one and the result should be discarded.
  const applyIdRef = useRef(0);

  // Helpers that update state + ref together
  const setMode = useCallback((m: BackgroundMode) => {
    modeRef.current = m;
    setModeState(m);
  }, []);
  const setImagePath = useCallback((p: string | null) => {
    imagePathRef.current = p;
    setImagePathState(p);
  }, []);

  // Check browser support on mount
  useEffect(() => {
    if (supportCheckedRef.current) return;
    supportCheckedRef.current = true;

    getTrackProcessors()
      .then((mod) => {
        if (typeof mod.supportsBackgroundProcessors === "function") {
          setIsSupported(mod.supportsBackgroundProcessors());
        }
      })
      .catch(() => {
        setIsSupported(false);
      });
  }, []);

  // Helper to get the local camera track
  const getCameraTrack = useCallback((): LocalVideoTrack | undefined => {
    if (!room) return undefined;
    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (!pub?.track || pub.track.kind !== Track.Kind.Video) return undefined;
    return pub.track as LocalVideoTrack;
  }, [room]);

  // Core apply function — stable across mode/imagePath changes thanks to refs.
  const applyEffect = useCallback(
    async (newMode: BackgroundMode, newImagePath: string | null) => {
      if (!room) {
        logInfo("[BackgroundEffect] No room, saving preference only");
        setMode(newMode);
        setImagePath(newImagePath);
        saveBackgroundPreference(newMode, newImagePath);
        return;
      }

      const cameraTrack = getCameraTrack();

      if (!cameraTrack) {
        logInfo("[BackgroundEffect] No camera track yet, saving preference for later");
        setMode(newMode);
        setImagePath(newImagePath);
        saveBackgroundPreference(newMode, newImagePath);
        return;
      }

      // Bump the call ID — any older in-flight call will see a mismatch and bail.
      const callId = ++applyIdRef.current;

      // Capture rollback snapshot from refs (always current).
      const prevMode = modeRef.current;
      const prevImagePath = imagePathRef.current;

      // Update state optimistically so the picker reflects the selection immediately,
      // even while the self-hosted MediaPipe assets initialize. We'll revert on failure.
      setMode(newMode);
      setImagePath(newImagePath);
      saveBackgroundPreference(newMode, newImagePath);
      setLastError(null);

      setIsProcessing(true);
      try {
        if (newMode === "none") {
          if (processorRef.current) {
            logInfo("[BackgroundEffect] Removing processor");
            await cameraTrack.stopProcessor();
            processorRef.current = null;
          }
        } else {
          const mod = await getTrackProcessors();
          // Superseded by a newer call — discard.
          if (callId !== applyIdRef.current) return;

          const processorOptions =
            newMode === "blur"
              ? { mode: "background-blur" as const, blurRadius: 12 }
              : { mode: "virtual-background" as const, imagePath: newImagePath! };

          if (processorRef.current) {
            logInfo(`[BackgroundEffect] Switching to: ${newMode}`);
            await processorRef.current.switchTo(processorOptions);
          } else {
            logInfo(`[BackgroundEffect] Creating processor: ${newMode}`);
            const processor = mod.BackgroundProcessor({
              ...processorOptions,
              assetPaths: { tasksVisionFileSet: MEDIAPIPE_ASSET_PATH, modelAssetPath: `${MEDIAPIPE_ASSET_PATH}/selfie_segmenter.tflite` },
            });
            processorRef.current = processor;
            await cameraTrack.setProcessor(processor);
          }
        }

        // Superseded — a newer call owns the final state.
        if (callId !== applyIdRef.current) return;
        logInfo(`[BackgroundEffect] Applied: ${newMode}`);
      } catch (err) {
        // Only revert if this is still the latest call.
        if (callId !== applyIdRef.current) return;
        logError("[BackgroundEffect] Failed to apply effect:", err);
        const message = describeProcessorError(err);
        setLastError(message);
        // Revert optimistic update on failure
        processorRef.current = null;
        setMode(prevMode);
        setImagePath(prevImagePath);
        saveBackgroundPreference(prevMode, prevImagePath);
      } finally {
        if (callId === applyIdRef.current) {
          setIsProcessing(false);
        }
      }
    },
    [room, getCameraTrack, setMode, setImagePath],
  );

  // When camera is toggled on, re-apply the saved background effect.
  // Reads mode/imagePath from refs so the handler stays fresh without
  // re-subscribing on every mode change.
  useEffect(() => {
    if (!room) return;

    const handleTrackPublished = (pub: LocalTrackPublication) => {
      // Only re-apply when the camera track is published
      if (pub.source !== Track.Source.Camera) return;
      if (modeRef.current === "none") return;

      logInfo("[BackgroundEffect] Camera published, re-applying effect");
      // Reset processor ref — old processor is tied to the old track
      processorRef.current = null;
      // Clear any pending re-apply timer before scheduling a new one
      if (reapplyTimerRef.current !== null) {
        clearTimeout(reapplyTimerRef.current);
      }
      // Delay to ensure track is fully ready; store ID so it can be cleared on unmount
      reapplyTimerRef.current = setTimeout(() => {
        reapplyTimerRef.current = null;
        applyEffect(modeRef.current, imagePathRef.current);
      }, 300);
    };

    room.on(RoomEvent.LocalTrackPublished, handleTrackPublished);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, handleTrackPublished);
      // Clear any pending re-apply timer when the effect re-runs or unmounts
      if (reapplyTimerRef.current !== null) {
        clearTimeout(reapplyTimerRef.current);
        reapplyTimerRef.current = null;
      }
    };
  }, [room, applyEffect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const processor = processorRef.current;
      processorRef.current = null;
      void destroyBackgroundProcessor(processor);
      if (reapplyTimerRef.current !== null) {
        clearTimeout(reapplyTimerRef.current);
        reapplyTimerRef.current = null;
      }
    };
  }, []);

  const setBlur = useCallback(() => applyEffect("blur", imagePathRef.current), [applyEffect]);
  const setImage = useCallback(
    (path: string) => applyEffect("image", path),
    [applyEffect],
  );
  const clearEffect = useCallback(() => applyEffect("none", null), [applyEffect]);

  const state: BackgroundEffectState = { mode, imagePath, isSupported, isProcessing, lastError };

  return { ...state, setBlur, setImage, clearEffect, applyEffect };
}

/**
 * Standalone function to apply a background effect to a raw LocalVideoTrack
 * (used in PreJoinScreen where there's no Room yet).
 */
export async function applyBackgroundToTrack(
  track: import("livekit-client").LocalVideoTrack,
  mode: BackgroundMode,
  imagePath: string | null,
  processorRef: React.MutableRefObject<BackgroundProcessorWrapper | null>,
) {
  if (mode === "none") {
    if (processorRef.current) {
      await track.stopProcessor();
      processorRef.current = null;
    }
    saveBackgroundPreference(mode, imagePath);
    return;
  }

  const mod = await getTrackProcessors();
  const opts =
    mode === "blur"
      ? { mode: "background-blur" as const, blurRadius: 12 }
      : { mode: "virtual-background" as const, imagePath: imagePath! };

  if (processorRef.current) {
    await processorRef.current.switchTo(opts);
  } else {
    const processor = mod.BackgroundProcessor({
      ...opts,
      assetPaths: { tasksVisionFileSet: MEDIAPIPE_ASSET_PATH, modelAssetPath: `${MEDIAPIPE_ASSET_PATH}/selfie_segmenter.tflite` },
    });
    processorRef.current = processor;
    await track.setProcessor(processor);
  }
  saveBackgroundPreference(mode, imagePath);
}
