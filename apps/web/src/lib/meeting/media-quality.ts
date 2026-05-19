import {
  AudioPresets,
  VideoPresets,
  type TrackPublishOptions,
  type AudioCaptureOptions,
  type VideoCaptureOptions,
  type ScreenShareCaptureOptions,
  type VideoCodec,
} from "livekit-client";

type CameraCodec = Extract<VideoCodec, "h264" | "vp8">;
type ScreenShareCodec = Extract<VideoCodec, "h264" | "vp8">;

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod|android/i.test(navigator.userAgent);
}

export interface BrowserMediaEnvironment {
  userAgent?: string;
  platform?: string;
  /**
   * Whether the browser advertises support for encoding VP8 video.
   * VP8 is the universal baseline web codec; H.264 is only used as a
   * fallback when VP8 is unavailable.
   */
  supportsVp8?: boolean;
}

function getUserAgent(env: BrowserMediaEnvironment) {
  return env.userAgent ?? "";
}

function getPlatform(env: BrowserMediaEnvironment) {
  return env.platform ?? "";
}

function isSafariUserAgent(userAgent: string) {
  return /^((?!chrome|chromium|android).)*safari/i.test(userAgent);
}

function isIOSUserAgent(userAgent: string) {
  return /iphone|ipad|ipod/i.test(userAgent);
}

function isAndroidUserAgent(userAgent: string) {
  return /android/i.test(userAgent);
}

function isChromiumUserAgent(userAgent: string) {
  return /chrome|crios|edg|edge|opera|opr\//i.test(userAgent);
}

function isFirefoxUserAgent(userAgent: string) {
  return /firefox\//i.test(userAgent);
}

function isDesktopApplePlatform(platform: string) {
  return /mac/i.test(platform);
}

function isMobileEnvironment(env: BrowserMediaEnvironment) {
  const userAgent = getUserAgent(env);
  return isIOSUserAgent(userAgent) || isAndroidUserAgent(userAgent);
}

export function isSafariOrIOSEnvironment(env: BrowserMediaEnvironment) {
  const userAgent = getUserAgent(env);
  return isSafariUserAgent(userAgent) || isIOSUserAgent(userAgent);
}

export function isSafariOrIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return isSafariOrIOSEnvironment({
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
  });
}

function supportsNavigatorVideoCodec(codec: CameraCodec | ScreenShareCodec) {
  if (
    typeof RTCRtpSender === "undefined" ||
    typeof RTCRtpSender.getCapabilities !== "function"
  ) {
    return false;
  }

  const caps = RTCRtpSender.getCapabilities("video");
  return caps?.codecs?.some((item) => item.mimeType.toLowerCase() === `video/${codec}`) ?? false;
}

/**
 * Picks a camera codec.
 *
 * Policy is split by device class because the trade-offs differ:
 *
 *   • Mobile (iPad / iPhone / Android): H.264. Every mobile SoC since
 *     ~2012 has dedicated H.264 hardware encoders (Apple VideoToolbox,
 *     Qualcomm Venus, etc.) — encoding cost is near zero. For hour-long
 *     meetings this is worth ~5–10% of battery vs. software VP8. The
 *     historical Safari/H.264 profile-flapping bug is mitigated by
 *     republishing the camera track on device switch (see
 *     handleSelectVideoDevice in use-meeting-room.ts).
 *
 *   • Desktop: VP8. Software encoding is free on plugged-in laptops
 *     and desktops, and VP8 is decoded natively by every supported
 *     browser without profile/PT negotiation surprises.
 *
 * Both fall back to H.264 if the browser somehow lacks VP8 (very old
 * Safari).
 */
export function resolveCameraCodecForEnvironment(
  env: BrowserMediaEnvironment,
): CameraCodec {
  if (isMobileEnvironment(env)) return "h264";
  return env.supportsVp8 === false ? "h264" : "vp8";
}

export function resolveCameraCodec(): CameraCodec {
  if (typeof navigator === "undefined") return "vp8";

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return resolveCameraCodecForEnvironment({
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
    supportsVp8: supportsNavigatorVideoCodec("vp8"),
  });
}

/**
 * Camera capture defaults.
 *
 * Desktop captures at 1080p; mobile stays at 720p to keep battery and
 * thermals reasonable. Switching from H.264 to VP8 means we no longer
 * have to cap desktop at 720p to avoid Safari's H.264 layer-flapping
 * bug, so we can give modern displays the resolution they deserve.
 */
export function getCameraCaptureDefaultsForEnvironment(
  env: BrowserMediaEnvironment,
): Pick<VideoCaptureOptions, "resolution" | "frameRate" | "facingMode"> {
  return {
    resolution: isMobileEnvironment(env)
      ? VideoPresets.h720.resolution
      : VideoPresets.h1080.resolution,
    frameRate: 30,
    facingMode: "user",
  };
}

export function getCameraCaptureDefaults(): Pick<
  VideoCaptureOptions,
  "resolution" | "frameRate" | "facingMode"
> {
  if (typeof navigator === "undefined") {
    return {
      resolution: VideoPresets.h1080.resolution,
      frameRate: 30,
      facingMode: "user",
    };
  }

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return getCameraCaptureDefaultsForEnvironment({
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
  });
}

/**
 * Camera publish defaults.
 *
 * - VP8 baseline (H.264 fallback only). No backupCodec — VP8 is decoded
 *   natively by every browser we support.
 * - Three-layer simulcast: the listed presets become the lower
 *   simulcast streams; the SDK adds the capture resolution as the top
 *   layer. So desktop publishes h360/h720/h1080 and mobile publishes
 *   h180/h360/h720.
 * - Bitrate is sized for the top layer (1080p30 desktop / 720p30
 *   mobile).
 */
export function getCameraPublishDefaultsForEnvironment(
  env: BrowserMediaEnvironment,
): Pick<
  TrackPublishOptions,
  "backupCodec" | "videoCodec" | "videoEncoding" | "videoSimulcastLayers"
> {
  const mobile = isMobileEnvironment(env);

  return {
    videoCodec: resolveCameraCodecForEnvironment(env),
    backupCodec: false,
    videoEncoding: {
      maxBitrate: mobile ? 2_000_000 : 3_500_000,
      maxFramerate: 30,
    },
    videoSimulcastLayers: mobile
      ? [VideoPresets.h180, VideoPresets.h360]
      : [VideoPresets.h360, VideoPresets.h720],
  };
}

export function getCameraPublishDefaults(): Pick<
  TrackPublishOptions,
  "backupCodec" | "videoCodec" | "videoEncoding" | "videoSimulcastLayers"
> {
  if (typeof navigator === "undefined") {
    return {
      videoCodec: "vp8",
      backupCodec: false,
      videoEncoding: {
        maxBitrate: 3_500_000,
        maxFramerate: 30,
      },
      videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720],
    };
  }

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return getCameraPublishDefaultsForEnvironment({
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
    supportsVp8: supportsNavigatorVideoCodec("vp8"),
  });
}

/**
 * Voice mic capture defaults.
 *
 * Keep this in one place so pre-join device probing, room startup, and
 * processor fallbacks all ask the browser for the same audio processing path.
 * Echo cancellation is the non-negotiable part for conferencing. Native noise
 * suppression is intentionally left on even when Krisp is active, per LiveKit's
 * guidance that standard noise cancellation and echo cancellation can remain
 * enabled with frontend noise filters.
 */
export function getVoiceAudioCaptureDefaults(): Pick<
  AudioCaptureOptions,
  "autoGainControl" | "channelCount" | "echoCancellation" | "noiseSuppression"
> {
  return {
    autoGainControl: true,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
  };
}

/**
 * Screen share codec. Same policy as the camera: VP8 is the boring
 * universal default, H.264 is only used if VP8 is unavailable. We do
 * not default to VP9 here because Firefox VP9 support is partial and
 * Windows H.264 tab-share has historically been unstable; VP8 sidesteps
 * both issues.
 */
export function resolveScreenShareCodecForEnvironment(
  env: BrowserMediaEnvironment,
): ScreenShareCodec {
  return env.supportsVp8 === false ? "h264" : "vp8";
}

export function resolveScreenShareCodec(): ScreenShareCodec {
  if (typeof navigator === "undefined") return "vp8";

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return resolveScreenShareCodecForEnvironment({
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
    supportsVp8: supportsNavigatorVideoCodec("vp8"),
  });
}

export function getScreenShareCaptureOptionsForEnvironment(
  env: BrowserMediaEnvironment,
): ScreenShareCaptureOptions {
  const userAgent = getUserAgent(env);
  const platform = getPlatform(env);
  const isSafari = isSafariUserAgent(userAgent);
  const isChromium = isChromiumUserAgent(userAgent);
  const isFirefox = isFirefoxUserAgent(userAgent);
  const isIOS = isIOSUserAgent(userAgent);
  const isMobile = isMobileEnvironment(env);
  const isDesktopApple = isDesktopApplePlatform(platform);
  const canRequestBrowserAudio = isChromium && !isIOS;
  const canUseBrowserSurfaceHints = (isChromium || isFirefox) && !isIOS;
  // "detail" is best for code/slides/UIs on desktop (current Mac+Chromium
  // path stays unchanged); fall back to "text" for everyone else, which is
  // still text-friendly but a touch less aggressive about preserving
  // single-pixel detail.
  const contentHint = isDesktopApple && !isSafari ? "detail" : "text";

  return {
    audio: canRequestBrowserAudio,
    video: true,
    contentHint,
    preferCurrentTab: canRequestBrowserAudio || canUseBrowserSurfaceHints,
    selfBrowserSurface: "exclude",
    surfaceSwitching: isChromium ? "include" : undefined,
    systemAudio: canRequestBrowserAudio ? "include" : undefined,
    suppressLocalAudioPlayback: canRequestBrowserAudio,
    // Don't force a resolution on Safari (their constraint handling is
    // finicky) or on mobile (let the device pick something sensible).
    resolution: isSafari || isMobile ? undefined : VideoPresets.h1080.resolution,
  };
}

export function getScreenShareCaptureOptions(): ScreenShareCaptureOptions {
  if (typeof navigator === "undefined") {
    return {
      audio: false,
      video: true,
      contentHint: "text",
      resolution: VideoPresets.h1080.resolution,
    };
  }

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return getScreenShareCaptureOptionsForEnvironment({
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
  });
}

/**
 * Screen share publish defaults.
 *
 * - VP8 baseline (H.264 fallback only). No backupCodec.
 * - "maintain-resolution" so text/slides stay sharp under bandwidth
 *   pressure (motion gets choppier instead of going blurry).
 * - 5 Mbps desktop / 2.5 Mbps mobile for 1080p/720p screen content.
 */
export function getScreenShareVideoPublishOptionsForEnvironment(
  env: BrowserMediaEnvironment,
): Pick<
  TrackPublishOptions,
  | "backupCodec"
  | "degradationPreference"
  | "videoCodec"
  | "screenShareEncoding"
  | "screenShareSimulcastLayers"
> {
  const mobile = isMobileEnvironment(env);

  return {
    videoCodec: resolveScreenShareCodecForEnvironment(env),
    backupCodec: false,
    degradationPreference: "maintain-resolution",
    screenShareEncoding: {
      maxBitrate: mobile ? 2_500_000 : 5_000_000,
      maxFramerate: 30,
    },
    screenShareSimulcastLayers: mobile
      ? [VideoPresets.h720]
      : [VideoPresets.h720, VideoPresets.h1080],
  };
}

export function getScreenShareVideoPublishOptions(): Pick<
  TrackPublishOptions,
  | "backupCodec"
  | "degradationPreference"
  | "videoCodec"
  | "screenShareEncoding"
  | "screenShareSimulcastLayers"
> {
  if (typeof navigator === "undefined") {
    return {
      videoCodec: "vp8",
      backupCodec: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 5_000_000,
        maxFramerate: 30,
      },
      screenShareSimulcastLayers: [VideoPresets.h720, VideoPresets.h1080],
    };
  }

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return getScreenShareVideoPublishOptionsForEnvironment({
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
    supportsVp8: supportsNavigatorVideoCodec("vp8"),
  });
}

/**
 * Audio publish defaults for shared tab/system audio. Hi-fi stereo,
 * RED/DTX disabled, suitable for music/video being shared from a tab.
 * Microphone audio uses a separate, voice-tuned profile in
 * ROOM_OPTIONS.publishDefaults.
 */
export function getScreenShareAudioPublishOptions(): Pick<
  TrackPublishOptions,
  "audioPreset" | "dtx" | "forceStereo" | "red"
> {
  return {
    audioPreset: AudioPresets.musicHighQualityStereo,
    dtx: false,
    forceStereo: true,
    red: false,
  };
}

/**
 * Returns true if the current browser advertises support for the given
 * MediaTrackConstraint name (e.g. "voiceIsolation"). Used to gate
 * Safari-only constraints so Firefox/Chrome don't reject the call.
 */
export function browserSupportsMediaConstraint(name: string): boolean {
  if (typeof navigator === "undefined") return false;
  const supported = navigator.mediaDevices?.getSupportedConstraints?.();
  return Boolean(supported && (supported as Record<string, unknown>)[name]);
}
