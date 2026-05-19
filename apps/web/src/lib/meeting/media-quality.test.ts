import { describe, expect, it } from "vitest";

import {
  getCameraCaptureDefaultsForEnvironment,
  getCameraPublishDefaultsForEnvironment,
  getScreenShareCaptureOptionsForEnvironment,
  getScreenShareVideoPublishOptionsForEnvironment,
  getScreenShareAudioPublishOptions,
  getVoiceAudioCaptureDefaults,
  isSafariOrIOSEnvironment,
  resolveCameraCodecForEnvironment,
  resolveScreenShareCodecForEnvironment,
} from "./media-quality";

const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  chromeLinux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  safariIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
  safariIPad:
    "Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36",
  chromeIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/136.0.0.0 Mobile/15E148 Safari/604.1",
  firefoxMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:150.0) Gecko/20100101 Firefox/150.0",
};

describe("resolveCameraCodecForEnvironment", () => {
  it("uses vp8 on desktop browsers", () => {
    expect(
      resolveCameraCodecForEnvironment({
        userAgent: UA.chromeWindows,
        platform: "Windows",
        supportsVp8: true,
      }),
    ).toBe("vp8");
    expect(
      resolveCameraCodecForEnvironment({
        userAgent: UA.safariMac,
        platform: "macOS",
        supportsVp8: true,
      }),
    ).toBe("vp8");
    expect(
      resolveCameraCodecForEnvironment({
        userAgent: UA.firefoxMac,
        platform: "macOS",
        supportsVp8: true,
      }),
    ).toBe("vp8");
  });

  it("uses h264 on mobile devices regardless of vp8 support", () => {
    expect(
      resolveCameraCodecForEnvironment({
        userAgent: UA.safariIPad,
        platform: "iOS",
        supportsVp8: true,
      }),
    ).toBe("h264");
    expect(
      resolveCameraCodecForEnvironment({
        userAgent: UA.safariIOS,
        platform: "iOS",
        supportsVp8: true,
      }),
    ).toBe("h264");
    expect(
      resolveCameraCodecForEnvironment({
        userAgent: UA.chromeAndroid,
        platform: "Android",
        supportsVp8: true,
      }),
    ).toBe("h264");
  });

  it("falls back to h264 when vp8 is unavailable", () => {
    expect(
      resolveCameraCodecForEnvironment({
        userAgent: UA.chromeLinux,
        platform: "Linux",
        supportsVp8: false,
      }),
    ).toBe("h264");
  });
});

describe("getCameraCaptureDefaultsForEnvironment", () => {
  it("captures at 1080p on desktop", () => {
    const desktop = getCameraCaptureDefaultsForEnvironment({
      userAgent: UA.chromeWindows,
      platform: "Windows",
    });
    expect(desktop.resolution).toMatchObject({ width: 1920, height: 1080, frameRate: 30 });
    expect(desktop.frameRate).toBe(30);
    expect(desktop.facingMode).toBe("user");
  });

  it("caps capture at 720p on mobile to spare battery and thermals", () => {
    const mobile = getCameraCaptureDefaultsForEnvironment({
      userAgent: UA.chromeAndroid,
      platform: "Android",
    });
    expect(mobile.resolution).toMatchObject({ width: 1280, height: 720, frameRate: 30 });

    const ipad = getCameraCaptureDefaultsForEnvironment({
      userAgent: UA.safariIPad,
      platform: "iOS",
    });
    expect(ipad.resolution).toMatchObject({ width: 1280, height: 720, frameRate: 30 });
  });
});

describe("getCameraPublishDefaultsForEnvironment", () => {
  it("publishes vp8 with no backup codec at 1080p on desktop", () => {
    const options = getCameraPublishDefaultsForEnvironment({
      userAgent: UA.chromeLinux,
      platform: "Linux",
      supportsVp8: true,
    });

    expect(options.videoCodec).toBe("vp8");
    expect(options.backupCodec).toBe(false);
    expect(options.videoEncoding).toEqual({ maxBitrate: 3_500_000, maxFramerate: 30 });
    // The capture resolution (1080p on desktop) is added by the SDK as the
    // top simulcast layer; the listed presets are the lower variants.
    expect(options.videoSimulcastLayers).toEqual([
      expect.objectContaining({ width: 640, height: 360 }),
      expect.objectContaining({ width: 1280, height: 720 }),
    ]);
  });

  it("publishes h264 with mobile bitrate ceiling on iOS", () => {
    const options = getCameraPublishDefaultsForEnvironment({
      userAgent: UA.safariIPad,
      platform: "iOS",
      supportsVp8: true,
    });

    expect(options.videoCodec).toBe("h264");
    expect(options.backupCodec).toBe(false);
    expect(options.videoEncoding).toEqual({ maxBitrate: 2_000_000, maxFramerate: 30 });
    expect(options.videoSimulcastLayers).toEqual([
      expect.objectContaining({ width: 320, height: 180 }),
      expect.objectContaining({ width: 640, height: 360 }),
    ]);
  });

  it("falls back to h264 when vp8 is unavailable", () => {
    const options = getCameraPublishDefaultsForEnvironment({
      userAgent: UA.chromeLinux,
      platform: "Linux",
      supportsVp8: false,
    });

    expect(options.videoCodec).toBe("h264");
    expect(options.backupCodec).toBe(false);
  });
});

describe("getVoiceAudioCaptureDefaults", () => {
  it("uses a mono voice profile with native cleanup enabled", () => {
    expect(getVoiceAudioCaptureDefaults()).toEqual({
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    });
  });
});

describe("resolveScreenShareCodecForEnvironment", () => {
  it("defaults to vp8 across browsers", () => {
    expect(
      resolveScreenShareCodecForEnvironment({
        userAgent: UA.safariMac,
        platform: "macOS",
        supportsVp8: true,
      }),
    ).toBe("vp8");
    expect(
      resolveScreenShareCodecForEnvironment({
        userAgent: UA.chromeWindows,
        platform: "Windows",
        supportsVp8: true,
      }),
    ).toBe("vp8");
    expect(
      resolveScreenShareCodecForEnvironment({
        userAgent: UA.chromeLinux,
        platform: "Linux",
        supportsVp8: true,
      }),
    ).toBe("vp8");
  });

  it("falls back to h264 when vp8 is unavailable", () => {
    expect(
      resolveScreenShareCodecForEnvironment({
        userAgent: UA.chromeLinux,
        platform: "Linux",
        supportsVp8: false,
      }),
    ).toBe("h264");
  });
});

describe("getScreenShareCaptureOptionsForEnvironment", () => {
  it("requests browser audio and tab controls on Chromium desktop", () => {
    const options = getScreenShareCaptureOptionsForEnvironment({
      userAgent: UA.chromeWindows,
      platform: "Windows",
    });

    expect(options.audio).toBe(true);
    expect(options.preferCurrentTab).toBe(true);
    expect(options.selfBrowserSurface).toBe("exclude");
    expect(options.surfaceSwitching).toBe("include");
    expect(options.systemAudio).toBe("include");
    expect(options.contentHint).toBe("text");
    expect(options.resolution).toMatchObject({ width: 1920, height: 1080, frameRate: 30 });
  });

  it("uses 'detail' content hint for Chromium on macOS", () => {
    const options = getScreenShareCaptureOptionsForEnvironment({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      platform: "macOS",
    });

    expect(options.contentHint).toBe("detail");
  });

  it("avoids forcing a resolution on Safari", () => {
    const options = getScreenShareCaptureOptionsForEnvironment({
      userAgent: UA.safariMac,
      platform: "macOS",
    });

    expect(options.audio).toBe(false);
    expect(options.resolution).toBeUndefined();
  });

  it("does not request browser audio on iOS Chromium and skips forced resolution", () => {
    const options = getScreenShareCaptureOptionsForEnvironment({
      userAgent: UA.chromeIOS,
      platform: "iOS",
    });

    expect(options.audio).toBe(false);
    expect(options.systemAudio).toBeUndefined();
    expect(options.resolution).toBeUndefined();
  });
});

describe("getScreenShareVideoPublishOptionsForEnvironment", () => {
  it("publishes vp8 with maintain-resolution on desktop", () => {
    const options = getScreenShareVideoPublishOptionsForEnvironment({
      userAgent: UA.chromeWindows,
      platform: "Windows",
      supportsVp8: true,
    });

    expect(options.videoCodec).toBe("vp8");
    expect(options.backupCodec).toBe(false);
    expect(options.degradationPreference).toBe("maintain-resolution");
    expect(options.screenShareEncoding).toEqual({ maxBitrate: 5_000_000, maxFramerate: 30 });
    expect(options.screenShareSimulcastLayers).toEqual([
      expect.objectContaining({ width: 1280, height: 720 }),
      expect.objectContaining({ width: 1920, height: 1080 }),
    ]);
  });

  it("uses a single 720p layer and lower bitrate on mobile", () => {
    const options = getScreenShareVideoPublishOptionsForEnvironment({
      userAgent: UA.safariIPad,
      platform: "iOS",
      supportsVp8: true,
    });

    expect(options.videoCodec).toBe("vp8");
    expect(options.screenShareEncoding).toEqual({ maxBitrate: 2_500_000, maxFramerate: 30 });
    expect(options.screenShareSimulcastLayers).toEqual([
      expect.objectContaining({ width: 1280, height: 720 }),
    ]);
  });

  it("falls back to h264 when vp8 is unavailable", () => {
    const options = getScreenShareVideoPublishOptionsForEnvironment({
      userAgent: UA.chromeLinux,
      platform: "Linux",
      supportsVp8: false,
    });

    expect(options.videoCodec).toBe("h264");
    expect(options.backupCodec).toBe(false);
  });
});

describe("getScreenShareAudioPublishOptions", () => {
  it("uses a hi-fi stereo profile for shared tab audio", () => {
    const options = getScreenShareAudioPublishOptions();

    expect(options.audioPreset).toEqual({ maxBitrate: 128_000 });
    expect(options.forceStereo).toBe(true);
    expect(options.dtx).toBe(false);
    expect(options.red).toBe(false);
  });
});

describe("isSafariOrIOSEnvironment", () => {
  it("matches Safari macOS, iOS, and iPad", () => {
    expect(isSafariOrIOSEnvironment({ userAgent: UA.safariMac, platform: "macOS" })).toBe(true);
    expect(isSafariOrIOSEnvironment({ userAgent: UA.safariIOS, platform: "iOS" })).toBe(true);
    expect(isSafariOrIOSEnvironment({ userAgent: UA.safariIPad, platform: "iOS" })).toBe(true);
    // Chrome on iOS is still WebKit under the hood — treat it the same.
    expect(isSafariOrIOSEnvironment({ userAgent: UA.chromeIOS, platform: "iOS" })).toBe(true);
  });

  it("does not match Chrome/Firefox on desktop", () => {
    expect(isSafariOrIOSEnvironment({ userAgent: UA.chromeWindows, platform: "Windows" })).toBe(false);
    expect(isSafariOrIOSEnvironment({ userAgent: UA.firefoxMac, platform: "macOS" })).toBe(false);
  });
});
