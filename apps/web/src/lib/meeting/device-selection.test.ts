import { describe, expect, it } from "vitest";
import {
  pickNativeAudioDevice,
  pickNativeVideoDevice,
} from "@/lib/meeting/device-selection";

function device(
  deviceId: string,
  label: string,
  kind: MediaDeviceKind,
): MediaDeviceInfo {
  return {
    deviceId,
    groupId: "",
    kind,
    label,
    toJSON: () => ({ deviceId, groupId: "", kind, label }),
  } as MediaDeviceInfo;
}

describe("pickNativeAudioDevice", () => {
  it("prefers the built-in Mac microphone over the browser default", () => {
    const picked = pickNativeAudioDevice([
      device("default", "Default - Microphone (macOS)", "audioinput"),
      device("iphone", "Atiq's iPhone Microphone", "audioinput"),
      device("macbook", "MacBook Pro Microphone", "audioinput"),
    ]);

    expect(picked?.deviceId).toBe("macbook");
  });

  it("avoids Continuity and wireless microphones when a neutral device exists", () => {
    const picked = pickNativeAudioDevice([
      device("iphone", "iPhone Microphone", "audioinput"),
      device("airpods", "AirPods Pro", "audioinput"),
      device("usb", "USB Audio Device", "audioinput"),
    ]);

    expect(picked?.deviceId).toBe("usb");
  });
});

describe("pickNativeVideoDevice", () => {
  it("prefers FaceTime camera over Continuity Camera", () => {
    const picked = pickNativeVideoDevice([
      device("default", "Default - Camera", "videoinput"),
      device("iphone", "Atiq's iPhone Camera", "videoinput"),
      device("facetime", "FaceTime HD Camera", "videoinput"),
    ]);

    expect(picked?.deviceId).toBe("facetime");
  });
});
