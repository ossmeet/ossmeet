import * as React from "react";
import {
  createLocalTracks,
  VideoPresets,
  type LocalVideoTrack,
} from "livekit-client";
import {
  CameraOff,
  ChevronDown,
  Mic,
  MicOff,
  MonitorUp,
  RotateCcw,
  Sparkles,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@ossmeet/shared";
import { logError } from "@/lib/logger-client";
import { markMeetingEntryMetric } from "@/lib/meeting/entry-metrics";
import {
  type BackgroundMode,
  applyBackgroundToTrack,
  describeProcessorError,
  destroyBackgroundProcessor,
  loadBackgroundPreference,
  saveBackgroundPreference,
} from "@/lib/meeting/use-background-effect";
import { BackgroundEffectPicker } from "@/components/meeting/background-effect-picker";
import { CaptionLanguagePicker } from "@/components/meeting/caption-language-picker";
import { getClientMeetingHints } from "@/server/client-hints";
import { isSpeechRecognitionSupported } from "@/lib/meeting/speech-recognition-support";
import {
  DEFAULT_SPEECH_LANGUAGE,
  loadSavedSpeechLanguage,
  pickSpeechLanguage,
  saveSpeechLanguage,
  SPEECH_LANGUAGE_OPTIONS,
  speechLanguageDisplayName,
} from "@/lib/meeting/speech-languages";

export interface PreJoinScreenProps {
  meetingTitle?: string;
  waitingForHost?: boolean;
  /** Authenticated user — name is pre-filled and locked (non-editable). */
  user?: { name: string };
  onJoin: (
    videoDeviceId: string | undefined,
    audioDeviceId: string | undefined,
    videoEnabled: boolean,
    audioEnabled: boolean,
    displayName?: string,
    captionLanguage?: string
  ) => void;
}

const STORAGE_KEY = "ossmeet.prejoin.v1";
const INSECURE_CONTEXT_MESSAGE =
  "Camera/microphone are only available on HTTPS or localhost. You can still join with audio/video off.";
const NO_CAMERA_MESSAGE =
  "No camera detected. You can still join without video.";
const NO_MICROPHONE_MESSAGE =
  "No microphone detected. You can still join without audio.";
const NO_MEDIA_DEVICES_MESSAGE =
  "No camera or microphone detected. You can still join without audio or video.";

function loadPreferences(): {
  videoEnabled: boolean;
  audioEnabled: boolean;
  videoDeviceId?: string;
  audioDeviceId?: string;
} {
  if (typeof window === "undefined") {
    return { videoEnabled: true, audioEnabled: true };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { videoEnabled: true, audioEnabled: true };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      // A new meeting should start with mic/camera on. Only device choices persist.
      videoEnabled: true,
      audioEnabled: true,
      videoDeviceId:
        typeof parsed?.videoDeviceId === "string"
          ? parsed.videoDeviceId
          : undefined,
      audioDeviceId:
        typeof parsed?.audioDeviceId === "string"
          ? parsed.audioDeviceId
          : undefined,
    };
  } catch {
    return { videoEnabled: true, audioEnabled: true };
  }
}

function savePreferences(
  update: Partial<Pick<ReturnType<typeof loadPreferences>, "videoDeviceId" | "audioDeviceId">>
): void {
  if (typeof window === "undefined") return;
  try {
    const current = loadPreferences();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        videoDeviceId: update.videoDeviceId ?? current.videoDeviceId,
        audioDeviceId: update.audioDeviceId ?? current.audioDeviceId,
      })
    );
  } catch {
    // ignore
  }
}

// ── Device label cache ────────────────────────────────────────────────────────
// Stores {deviceId, label, kind} so returning users see real labels instantly
// instead of waiting for getUserMedia + enumerateDevices to complete.

const DEVICE_CACHE_KEY = "ossmeet.devices.v1";

interface CachedDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
  groupId: string;
}

function loadDeviceCache(): { video: CachedDevice[]; audio: CachedDevice[] } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEVICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { video?: unknown[]; audio?: unknown[] };
    const toDevice = (d: unknown): CachedDevice | null => {
      if (!d || typeof d !== "object") return null;
      const o = d as Record<string, unknown>;
      if (typeof o.deviceId !== "string" || typeof o.label !== "string") return null;
      return { deviceId: o.deviceId, label: o.label, kind: o.kind as MediaDeviceKind, groupId: String(o.groupId ?? "") };
    };
    const video = (parsed.video ?? []).map(toDevice).filter(Boolean) as CachedDevice[];
    const audio = (parsed.audio ?? []).map(toDevice).filter(Boolean) as CachedDevice[];
    if (video.length === 0 && audio.length === 0) return null;
    return { video, audio };
  } catch {
    return null;
  }
}

function saveDeviceCache(video: MediaDeviceInfo[], audio: MediaDeviceInfo[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      DEVICE_CACHE_KEY,
      JSON.stringify({
        video: video.map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind, groupId: d.groupId })),
        audio: audio.map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind, groupId: d.groupId })),
      })
    );
  } catch {
    // ignore
  }
}

function cachedToMediaDeviceInfo(d: CachedDevice): MediaDeviceInfo {
  return { ...d, toJSON: () => d } as unknown as MediaDeviceInfo;
}

export function PreJoinScreen({ meetingTitle, waitingForHost = false, user, onJoin }: PreJoinScreenProps) {
  const prefs = React.useMemo(() => loadPreferences(), []);
  const deviceCache = React.useMemo(() => loadDeviceCache(), []);
  const speechSupported = React.useMemo(() => isSpeechRecognitionSupported(), []);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [localVideoTrack, setLocalVideoTrack] =
    React.useState<LocalVideoTrack | null>(null);
  const isCreatingTracksRef = React.useRef(false);
  const localVideoTrackRef = React.useRef<LocalVideoTrack | null>(null);

  const [videoEnabled, setVideoEnabled] = React.useState(prefs.videoEnabled);
  const [audioEnabled, setAudioEnabled] = React.useState(prefs.audioEnabled);
  const [selectedVideoDevice, setSelectedVideoDevice] = React.useState<
    string | undefined
  >(prefs.videoDeviceId);
  const [selectedAudioDevice, setSelectedAudioDevice] = React.useState<
    string | undefined
  >(prefs.audioDeviceId);
  const [cloudflareCountry, setCloudflareCountry] = React.useState<string | null>(null);
  const [captionLanguage, setCaptionLanguage] = React.useState(() =>
    speechSupported
      ? pickSpeechLanguage({
          savedLanguage: loadSavedSpeechLanguage(),
          navigatorLanguage: typeof navigator !== "undefined" ? navigator.language : null,
        })
      : ""
  );
  const [showCaptionLanguagePicker, setShowCaptionLanguagePicker] = React.useState(false);
  const captionLanguagePickerRef = React.useRef<HTMLDivElement>(null);

  // Background effect state for pre-join preview
  const bgProcessorRef = React.useRef<import("@livekit/track-processors").BackgroundProcessorWrapper | null>(null);
  const bgProcessorTrackRef = React.useRef<LocalVideoTrack | null>(null);
  const initialBgPreference = React.useMemo(() => loadBackgroundPreference(), []);
  const [bgMode, setBgModeState] = React.useState<BackgroundMode>(initialBgPreference.mode);
  const [bgImagePath, setBgImagePathState] = React.useState<string | null>(initialBgPreference.imagePath);
  const [bgProcessing, setBgProcessing] = React.useState(false);
  const [bgError, setBgError] = React.useState<string | null>(null);
  const [showBgPicker, setShowBgPicker] = React.useState(false);
  const bgPickerRef = React.useRef<HTMLDivElement>(null);
  const bgModeRef = React.useRef<BackgroundMode>(initialBgPreference.mode);
  const bgImagePathRef = React.useRef<string | null>(initialBgPreference.imagePath);
  const bgApplyIdRef = React.useRef(0);

  const setBgMode = React.useCallback((mode: BackgroundMode) => {
    bgModeRef.current = mode;
    setBgModeState(mode);
  }, []);

  const setBgImagePath = React.useCallback((path: string | null) => {
    bgImagePathRef.current = path;
    setBgImagePathState(path);
  }, []);

  // Close bg picker on outside click
  React.useEffect(() => {
    if (!showBgPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (bgPickerRef.current && !bgPickerRef.current.contains(e.target as Node)) {
        setShowBgPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showBgPicker]);

  const handleBgChange = React.useCallback(async (newMode: BackgroundMode, newImage: string | null) => {
    const track = localVideoTrackRef.current;
    const callId = ++bgApplyIdRef.current;
    const prevMode = bgModeRef.current;
    const prevImage = bgImagePathRef.current;

    setBgMode(newMode);
    setBgImagePath(newImage);
    saveBackgroundPreference(newMode, newImage);
    setBgError(null);

    if (!track) return;
    setBgProcessing(true);
    try {
      bgProcessorTrackRef.current = track;
      await applyBackgroundToTrack(track, newMode, newImage, bgProcessorRef);
      if (callId !== bgApplyIdRef.current) return;
      if (newMode === "none") bgProcessorTrackRef.current = null;
    } catch (err) {
      if (callId !== bgApplyIdRef.current) return;
      logError("Failed to apply background effect:", err);
      const message = describeProcessorError(err);
      setBgError(message);
      setBgMode(prevMode);
      setBgImagePath(prevImage);
      bgProcessorTrackRef.current = prevMode === "none" ? null : track;
      saveBackgroundPreference(prevMode, prevImage);
    } finally {
      if (callId === bgApplyIdRef.current) {
        setBgProcessing(false);
      }
    }
  }, [setBgImagePath, setBgMode]);

  const [displayName, setDisplayName] = React.useState(() => {
    if (user) return user.name;
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("ossmeet.user.name") || "";
  });

  const [videoDevices, setVideoDevices] = React.useState<MediaDeviceInfo[]>(
    () => deviceCache?.video.map(cachedToMediaDeviceInfo) ?? []
  );
  const [audioDevices, setAudioDevices] = React.useState<MediaDeviceInfo[]>(
    () => deviceCache?.audio.map(cachedToMediaDeviceInfo) ?? []
  );
  // If we have a cache we can show labels immediately; still re-enumerate in background.
  const [isLoadingDevices, setIsLoadingDevices] = React.useState(!deviceCache);
  const [deviceError, setDeviceError] = React.useState<string | null>(null);

  const abortControllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      markMeetingEntryMetric("prejoinReadyAt");
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  React.useEffect(() => {
    if (!speechSupported) return;
    let cancelled = false;
    getClientMeetingHints()
      .then((hints) => {
        if (cancelled) return;
        setCloudflareCountry(hints.country);
        setCaptionLanguage(() =>
          pickSpeechLanguage({
            savedLanguage: loadSavedSpeechLanguage(),
            country: hints.country,
            navigatorLanguage: typeof navigator !== "undefined" ? navigator.language : null,
          })
        );
      })
      .catch(() => {
        // Country is only a ranking hint; the selector remains fully usable.
      });
    return () => {
      cancelled = true;
    };
  }, [speechSupported]);

  React.useEffect(() => {
    if (!speechSupported || !captionLanguage) return;
    saveSpeechLanguage(captionLanguage);
  }, [captionLanguage, speechSupported]);

  React.useEffect(() => {
    if (!showCaptionLanguagePicker) return;
    const handleClick = (e: MouseEvent) => {
      if (
        captionLanguagePickerRef.current &&
        !captionLanguagePickerRef.current.contains(e.target as Node)
      ) {
        setShowCaptionLanguagePicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCaptionLanguagePicker]);

  const selectedCaptionLanguageLabel = React.useMemo(() => {
    const option = SPEECH_LANGUAGE_OPTIONS.find((candidate) => candidate.tag === captionLanguage);
    return option ? speechLanguageDisplayName(option) : "Select language";
  }, [captionLanguage]);

  const getDevices = React.useCallback(async () => {
    setIsLoadingDevices(true);
    setDeviceError(null);

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;

    try {
      if (typeof window !== "undefined" && !window.isSecureContext) {
        setVideoEnabled(false);
        setAudioEnabled(false);
        setVideoDevices([]);
        setAudioDevices([]);
        setDeviceError(INSECURE_CONTEXT_MESSAGE);
        return;
      }

      if (
        !navigator.mediaDevices?.getUserMedia ||
        !navigator.mediaDevices?.enumerateDevices
      ) {
        setVideoEnabled(false);
        setAudioEnabled(false);
        setVideoDevices([]);
        setAudioDevices([]);
        setDeviceError(
          "Media device APIs are not available in this browser."
        );
        return;
      }

      const streams: MediaStream[] = [];
      let videoGranted = false;
      let audioGranted = false;
      let videoProbeFailed = false;
      let audioProbeFailed = false;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        streams.push(stream);
        videoGranted = stream.getVideoTracks().length > 0;
        audioGranted = stream.getAudioTracks().length > 0;
      } catch {
        // Fall back to probing each device type independently so one missing
        // device does not block the other from being discovered.
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
          streams.push(stream);
          videoGranted = true;
        } catch {
          videoProbeFailed = true;
          // Video unavailable or denied — continue to try audio
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          streams.push(stream);
          audioGranted = true;
        } catch {
          audioProbeFailed = true;
          // Audio unavailable or denied — continue to enumerate what we can
        }
      }

      if (signal.aborted) return;

      // Enumerate while streams are still active — macOS clears labels once
      // all tracks are stopped, so this must happen before we release them.
      const devices = await navigator.mediaDevices.enumerateDevices();
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      if (signal.aborted) return;
      const freshVideo = devices.filter((d) => d.kind === "videoinput");
      const freshAudio = devices.filter((d) => d.kind === "audioinput");
      setVideoDevices(freshVideo);
      setAudioDevices(freshAudio);
      saveDeviceCache(freshVideo, freshAudio);

      const hasCamera = freshVideo.length > 0;
      const hasMicrophone = freshAudio.length > 0;

      if (!hasCamera) {
        setVideoEnabled(false);
        setSelectedVideoDevice(undefined);
      }
      if (!hasMicrophone) {
        setAudioEnabled(false);
        setSelectedAudioDevice(undefined);
      }

      if (!hasCamera && !hasMicrophone) {
        setDeviceError(NO_MEDIA_DEVICES_MESSAGE);
      } else if (
        videoProbeFailed &&
        audioProbeFailed &&
        !videoGranted &&
        !audioGranted
      ) {
        setVideoEnabled(false);
        setAudioEnabled(false);
        setDeviceError(
          "Could not access your camera or microphone. You can still join with audio/video off."
        );
      } else if (videoProbeFailed && !videoGranted) {
        setVideoEnabled(false);
        setDeviceError(
          hasCamera
            ? "Could not access your camera. You can still join with video off."
            : NO_CAMERA_MESSAGE
        );
      } else if (audioProbeFailed && !audioGranted) {
        setAudioEnabled(false);
        setDeviceError(
          hasMicrophone
            ? "Could not access your microphone. You can still join with audio off."
            : NO_MICROPHONE_MESSAGE
        );
      }
    } catch (err) {
      if (signal.aborted) return;
      logError("Failed to enumerate devices:", err);
      setVideoEnabled(false);
      setAudioEnabled(false);
      setSelectedVideoDevice(undefined);
      setSelectedAudioDevice(undefined);
      setDeviceError(
        "Could not access your camera or microphone. You can still join with audio/video off."
      );
    } finally {
      setIsLoadingDevices(false);
    }
  }, []);

  React.useEffect(() => {
    getDevices();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [getDevices]);

  React.useEffect(() => {
    if (
      videoDevices.length > 0 &&
      (!selectedVideoDevice ||
        !videoDevices.some((d) => d.deviceId === selectedVideoDevice))
    ) {
      const builtIn = videoDevices.find(
        (d) =>
          /built.?in|internal|facetime|integrated/i.test(d.label) &&
          !/iphone|ipad|continuity/i.test(d.label)
      );
      const defaultDev = videoDevices.find(
        (d) => d.deviceId === "default"
      );
      const best = builtIn || defaultDev || videoDevices[0];
      setSelectedVideoDevice(best?.deviceId);
    }
  }, [selectedVideoDevice, videoDevices]);

  React.useEffect(() => {
    if (
      audioDevices.length > 0 &&
      (!selectedAudioDevice ||
        !audioDevices.some((d) => d.deviceId === selectedAudioDevice))
    ) {
      const builtIn = audioDevices.find(
        (d) =>
          /built.?in|internal|macbook/i.test(d.label) &&
          !/iphone|ipad|airpods|bluetooth/i.test(d.label)
      );
      const defaultDev = audioDevices.find(
        (d) => d.deviceId === "default"
      );
      const best = builtIn || defaultDev || audioDevices[0];
      setSelectedAudioDevice(best?.deviceId);
    }
  }, [selectedAudioDevice, audioDevices]);

  React.useEffect(() => {
    if (!selectedVideoDevice) return;
    if (!videoDevices.some((d) => d.deviceId === selectedVideoDevice)) return;
    savePreferences({ videoDeviceId: selectedVideoDevice });
  }, [selectedVideoDevice, videoDevices]);

  React.useEffect(() => {
    if (!selectedAudioDevice) return;
    if (!audioDevices.some((d) => d.deviceId === selectedAudioDevice)) return;
    savePreferences({ audioDeviceId: selectedAudioDevice });
  }, [selectedAudioDevice, audioDevices]);

  React.useEffect(() => {
    localVideoTrackRef.current = localVideoTrack;
  }, [localVideoTrack]);

  const cleanupBackgroundProcessor = React.useCallback(async (track: LocalVideoTrack | null) => {
    if (track && bgProcessorTrackRef.current && bgProcessorTrackRef.current !== track) {
      return;
    }
    const processor = bgProcessorRef.current;
    bgProcessorRef.current = null;
    bgProcessorTrackRef.current = null;
    if (track) {
      try {
        await track.stopProcessor();
      } catch {
        // Track may already be stopped or may not have a processor.
      }
    }
    await destroyBackgroundProcessor(processor);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const stopTrack = (track: LocalVideoTrack | null) => {
      if (!track) return;
      void cleanupBackgroundProcessor(track);
      track.stop();
      if (track.mediaStreamTrack) track.mediaStreamTrack.stop();
    };

    const isSecureContext =
      typeof window === "undefined" || window.isSecureContext;

    if (!videoEnabled) {
      setLocalVideoTrack((prevTrack) => {
        if (prevTrack) stopTrack(prevTrack);
        return null;
      });
      return;
    }

    if (!isSecureContext) {
      setDeviceError(INSECURE_CONTEXT_MESSAGE);
      setLocalVideoTrack((prevTrack) => {
        if (prevTrack) stopTrack(prevTrack);
        return null;
      });
      return;
    }

    if (isLoadingDevices) return;
    if (videoDevices.length === 0) {
      setLocalVideoTrack((prevTrack) => {
        if (prevTrack) stopTrack(prevTrack);
        return null;
      });
      return;
    }
    if (!selectedVideoDevice) return;

    const createVideoTrack = async () => {
      if (cancelled) return;
      // Use ref to prevent concurrent track creation without blocking re-runs
      // after device auto-selection changes the effect deps
      if (isCreatingTracksRef.current) {
        // Another creation is in progress; it will be cancelled by the cleanup,
        // so we proceed to create a new track.
      }
      isCreatingTracksRef.current = true;

      try {
        if (localVideoTrackRef.current) {
          await cleanupBackgroundProcessor(localVideoTrackRef.current);
          stopTrack(localVideoTrackRef.current);
        }

        const tracks = await createLocalTracks({
          video: {
            deviceId: selectedVideoDevice,
            resolution: VideoPresets.h720.resolution,
          },
          audio: false,
        });

        if (cancelled) {
          tracks.forEach((t) => {
            t.stop();
            if (t.mediaStreamTrack) t.mediaStreamTrack.stop();
          });
          return;
        }

        const videoTrack = tracks.find((t) => t.kind === "video") as
          | LocalVideoTrack
          | undefined;
        if (videoTrack) {
          setLocalVideoTrack(videoTrack);
          if (videoRef.current) videoTrack.attach(videoRef.current);

          // Re-apply saved background effect to the new track
          const modeToApply = bgModeRef.current;
          const imageToApply = bgImagePathRef.current;
          if (modeToApply !== "none") {
            const callId = ++bgApplyIdRef.current;
            bgProcessorRef.current = null;
            bgProcessorTrackRef.current = videoTrack;
            setBgProcessing(true);
            applyBackgroundToTrack(videoTrack, modeToApply, imageToApply, bgProcessorRef)
              .then(() => {
                if (callId === bgApplyIdRef.current) setBgError(null);
              })
              .catch((err) => {
                if (callId !== bgApplyIdRef.current) return;
                logError("Failed to re-apply background:", err);
                bgProcessorTrackRef.current = null;
                setBgError(describeProcessorError(err));
              })
              .finally(() => {
                if (callId === bgApplyIdRef.current) setBgProcessing(false);
              });
          }
        }
      } catch (err) {
        logError("Failed to create video track:", err);
      } finally {
        isCreatingTracksRef.current = false;
      }
    };

    createVideoTrack();

    return () => {
      cancelled = true;
    };
  }, [
    isLoadingDevices,
    selectedVideoDevice,
    videoDevices.length,
    videoEnabled,
    cleanupBackgroundProcessor,
  ]);

  React.useEffect(() => {
    if (localVideoTrack && videoRef.current) {
      localVideoTrack.attach(videoRef.current);
    }
    return () => {
      if (localVideoTrack) {
        if (videoRef.current) {
          localVideoTrack.detach(videoRef.current);
        }
        void cleanupBackgroundProcessor(localVideoTrack);
        localVideoTrack.stop();
        if (localVideoTrack.mediaStreamTrack)
          localVideoTrack.mediaStreamTrack.stop();
      }
    };
  }, [cleanupBackgroundProcessor, localVideoTrack]);

  const handleVideoToggle = () => {
    if (
      !videoEnabled &&
      typeof window !== "undefined" &&
      !window.isSecureContext
    ) {
      setDeviceError(INSECURE_CONTEXT_MESSAGE);
      return;
    }
    if (!videoEnabled && videoDevices.length === 0) {
      setDeviceError(NO_CAMERA_MESSAGE);
      void getDevices();
      return;
    }
    const newValue = !videoEnabled;
    setVideoEnabled(newValue);
  };

  const handleAudioToggle = () => {
    if (
      !audioEnabled &&
      typeof window !== "undefined" &&
      !window.isSecureContext
    ) {
      setDeviceError(INSECURE_CONTEXT_MESSAGE);
      return;
    }
    if (!audioEnabled && audioDevices.length === 0) {
      setDeviceError(NO_MICROPHONE_MESSAGE);
      void getDevices();
      return;
    }
    const newValue = !audioEnabled;
    setAudioEnabled(newValue);
  };

  const handleJoin = () => {
    if (localVideoTrack) {
      void cleanupBackgroundProcessor(localVideoTrack);
      localVideoTrack.stop();
      if (localVideoTrack.mediaStreamTrack)
        localVideoTrack.mediaStreamTrack.stop();
    }
    const isSecureContext =
      typeof window === "undefined" || window.isSecureContext;
    const allowMedia = isSecureContext && !!navigator.mediaDevices;
    const shouldJoinWithVideo =
      allowMedia && videoEnabled && videoDevices.length > 0;
    const shouldJoinWithAudio =
      allowMedia && audioEnabled && audioDevices.length > 0;

    savePreferences({
      videoDeviceId: selectedVideoDevice,
      audioDeviceId: selectedAudioDevice,
    });

    const trimmedName = user ? user.name : displayName.trim();
    // Only persist the display name to localStorage for guests
    if (!user && trimmedName && typeof window !== "undefined") {
      window.localStorage.setItem("ossmeet.user.name", trimmedName);
    }

    onJoin(
      selectedVideoDevice,
      selectedAudioDevice,
      shouldJoinWithVideo,
      shouldJoinWithAudio,
      trimmedName || undefined,
      speechSupported ? captionLanguage : undefined
    );
  };

  const cameraPreviewLabel = isLoadingDevices
    ? "Looking for camera..."
    : videoDevices.length === 0
      ? "No camera detected"
      : videoEnabled
        ? "Starting camera..."
        : "Camera is off";

  return (
    <div className="relative min-h-[100dvh] w-full overflow-x-hidden overflow-y-auto bg-[#f5f3f0] font-sans selection:bg-teal-200 selection:text-teal-900">
      {/* Background pattern */}
      <div className="pointer-events-none fixed inset-0 bg-[#f5f3f0]" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(120,113,108,0.08)_1px,transparent_0)] bg-[size:24px_24px]" />

      {/* Top bar */}
      <div className="relative flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white">
            <Video className="h-4 w-4" />
          </div>
          <span className="font-semibold text-stone-800">OSSMeet</span>
        </div>
      </div>

      <div className="relative mx-auto flex min-h-[calc(100dvh-80px)] w-full max-w-[900px] flex-col px-6 py-6 md:py-8">
        {/* Header - Centered */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            {meetingTitle ? meetingTitle : "Ready to join?"}
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Check your audio and video before entering
          </p>
        </div>

        {/* Device Notice */}
        {deviceError && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <span className="font-medium">{deviceError}</span>
            </div>
            <button
              onClick={getDevices}
              className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-amber-800 shadow-sm hover:bg-amber-100"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        )}

        {/* Meeting Code Badge */}
        <div className="mb-6 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 shadow-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Meeting</span>
            <span className="text-sm font-semibold text-stone-800">{window.location.pathname.slice(1)}</span>
          </div>
        </div>

        {/* Main Card */}
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.06)]">
          {/* Two Column Layout */}
          <div className="grid sm:grid-cols-2">
            {/* Left: Video with Controls Overlay */}
            <div className="relative aspect-[4/3] overflow-hidden bg-stone-100 sm:aspect-auto">
              {videoEnabled && localVideoTrack ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover -scale-x-100"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-stone-200">
                    <CameraOff className="h-8 w-8 text-stone-400" />
                  </div>
                  <p className="text-sm font-medium text-stone-500">
                    {cameraPreviewLabel}
                  </p>
                </div>
              )}

              {/* Media Controls Overlay */}
              <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3">
                {/* Audio Toggle */}
                <button
                  onClick={handleAudioToggle}
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-200",
                    audioEnabled
                      ? "bg-white/90 text-stone-700 hover:bg-white backdrop-blur-sm"
                      : "bg-red-500 text-white hover:bg-red-600"
                  )}
                  aria-label={audioEnabled ? "Mute microphone" : "Unmute microphone"}
                >
                  {audioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                </button>

                {/* Video Toggle */}
                <button
                  onClick={handleVideoToggle}
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-200",
                    videoEnabled
                      ? "bg-white/90 text-stone-700 hover:bg-white backdrop-blur-sm"
                      : "bg-red-500 text-white hover:bg-red-600"
                  )}
                  aria-label={videoEnabled ? "Turn off camera" : "Turn on camera"}
                >
                  {videoEnabled ? <Video className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
                </button>

                {/* Background Effects (video related) */}
                {videoEnabled && (
                  <div ref={bgPickerRef} className="relative">
                    <button
                      onClick={() => setShowBgPicker((v) => !v)}
                      disabled={bgProcessing}
                      className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-200",
                        bgMode !== "none"
                          ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                          : "bg-white/90 text-stone-700 hover:bg-white backdrop-blur-sm",
                        bgProcessing && "cursor-not-allowed opacity-50"
                      )}
                      aria-label="Background effects"
                    >
                      <Sparkles className="h-5 w-5" />
                    </button>
                    {showBgPicker && (
                      <div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2">
                        <div className="rounded-xl border border-stone-200 bg-white p-1 shadow-xl">
                          <BackgroundEffectPicker
                            mode={bgMode}
                            imagePath={bgImagePath}
                            isProcessing={bgProcessing}
                            variant="light"
                            onSelectNone={() => { handleBgChange("none", null); setShowBgPicker(false); }}
                            onSelectBlur={() => { handleBgChange("blur", null); setShowBgPicker(false); }}
                            onSelectImage={(p) => { handleBgChange("image", p); setShowBgPicker(false); }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {bgError && (
                <div className="absolute inset-x-4 top-4 z-10 rounded-lg border border-red-200 bg-white/95 px-3 py-2 text-xs font-medium text-red-700 shadow-sm">
                  Background effect failed: {bgError}
                </div>
              )}
            </div>

            {/* Right: Settings Form */}
            <div className="flex flex-col justify-between p-6">
              <div className="space-y-4">

                {/* Name */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">
                    Your name
                  </label>
                  {user ? (
                  <div className="flex h-10 w-full items-center rounded-lg border border-stone-200 bg-stone-50 px-3">
                    <span className="text-sm font-medium text-stone-900">{user.name}</span>
                  </div>
                ) : (
                    <input
                      type="text"
                      maxLength={100}
                      placeholder="Enter your name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 placeholder-stone-400 transition-all focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    />
                  )}
                </div>

                {/* Camera */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">
                    Camera
                  </label>
                  <Select
                    value={videoDevices.length === 0 ? "" : (selectedVideoDevice || "")}
                    onValueChange={(v) => setSelectedVideoDevice(v ?? undefined)}
                    disabled={videoDevices.length === 0 || isLoadingDevices}
                    placeholder={isLoadingDevices ? "Loading..." : "No camera detected"}
                    options={
                      videoDevices.length === 0
                        ? [{ label: isLoadingDevices ? "Loading..." : "No camera detected", value: "" }]
                        : videoDevices.map((d) => ({
                            label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
                            value: d.deviceId,
                          }))
                    }
                  />
                </div>

                {/* Microphone */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">
                    Microphone
                  </label>
                  <Select
                    value={audioDevices.length === 0 ? "" : (selectedAudioDevice || "")}
                    onValueChange={(v) => setSelectedAudioDevice(v ?? undefined)}
                    disabled={audioDevices.length === 0 || isLoadingDevices}
                    placeholder={isLoadingDevices ? "Loading..." : "No microphone detected"}
                    options={
                      audioDevices.length === 0
                        ? [{ label: isLoadingDevices ? "Loading..." : "No microphone detected", value: "" }]
                        : audioDevices.map((d) => ({
                            label: d.label || `Mic ${d.deviceId.slice(0, 8)}`,
                            value: d.deviceId,
                          }))
                    }
                  />
                </div>

                {/* Caption Language */}
                {speechSupported && (
                  <div ref={captionLanguagePickerRef} className="relative">
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-stone-500">
                      Caption language
                    </label>
                    <button
                      onClick={() => setShowCaptionLanguagePicker((v) => !v)}
                      className="flex h-10 w-full items-center justify-between rounded-lg border border-stone-200 bg-white px-3 text-left text-sm text-stone-800 transition-all hover:border-stone-300 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    >
                      <span>{selectedCaptionLanguageLabel}</span>
                      <ChevronDown className={cn("h-4 w-4 text-stone-400 transition-transform", showCaptionLanguagePicker && "rotate-180")} />
                    </button>
                    {showCaptionLanguagePicker && (
                      <div className="absolute top-full z-30 mt-1 w-full">
                        <div className="rounded-xl border border-stone-200 bg-white p-1 shadow-xl">
                          <CaptionLanguagePicker
                            country={cloudflareCountry}
                            selectedLanguage={captionLanguage || DEFAULT_SPEECH_LANGUAGE}
                            onSelectLanguage={(language) => {
                              setCaptionLanguage(language);
                              setShowCaptionLanguagePicker(false);
                            }}
                            autoFocusSearch
                            variant="light"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Join Button */}
              <div className="mt-6 pt-4 border-t border-stone-100">
                {waitingForHost ? (
                  <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-amber-900">Waiting for host</span>
                      <span className="text-xs text-amber-700">You&apos;ll join automatically</span>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={isLoadingDevices || !displayName.trim()}
                    onClick={handleJoin}
                    className="h-11 w-full rounded-lg bg-teal-600 text-sm font-semibold text-white transition-all hover:bg-teal-700 disabled:opacity-50"
                  >
                    {isLoadingDevices ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Connecting...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <MonitorUp className="h-4 w-4" />
                        Join meeting
                      </span>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
