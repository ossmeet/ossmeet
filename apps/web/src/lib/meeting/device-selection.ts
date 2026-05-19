const DISFAVORED_APPLE_DEVICE_RE = /iphone|ipad|continuity/i;
const DISFAVORED_WIRELESS_AUDIO_RE =
  /airpods|bluetooth|beats|headset|hands-free|handsfree/i;
const NATIVE_AUDIO_RE =
  /built.?in|internal|macbook|mac microphone|studio display microphone/i;
const NATIVE_VIDEO_RE =
  /built.?in|internal|facetime|integrated|macbook/i;

function labelOf(device: Pick<MediaDeviceInfo, "label">) {
  return device.label.trim();
}

function isDefaultDevice(device: Pick<MediaDeviceInfo, "deviceId">) {
  return device.deviceId === "default";
}

function hasDisfavoredAudioLabel(device: Pick<MediaDeviceInfo, "label">) {
  const label = labelOf(device);
  return (
    DISFAVORED_APPLE_DEVICE_RE.test(label) ||
    DISFAVORED_WIRELESS_AUDIO_RE.test(label)
  );
}

function hasDisfavoredVideoLabel(device: Pick<MediaDeviceInfo, "label">) {
  return DISFAVORED_APPLE_DEVICE_RE.test(labelOf(device));
}

function rankAudioDevice(device: MediaDeviceInfo) {
  const label = labelOf(device);
  if (label && hasDisfavoredAudioLabel(device)) return 50;
  if (label && NATIVE_AUDIO_RE.test(label) && !isDefaultDevice(device)) return 0;
  if (label && NATIVE_AUDIO_RE.test(label)) return 1;
  if (!isDefaultDevice(device)) return 10;
  return 20;
}

function rankVideoDevice(device: MediaDeviceInfo) {
  const label = labelOf(device);
  if (label && hasDisfavoredVideoLabel(device)) return 50;
  if (label && NATIVE_VIDEO_RE.test(label) && !isDefaultDevice(device)) return 0;
  if (label && NATIVE_VIDEO_RE.test(label)) return 1;
  if (!isDefaultDevice(device)) return 10;
  return 20;
}

function pickRankedDevice(
  devices: MediaDeviceInfo[],
  rank: (device: MediaDeviceInfo) => number,
) {
  return devices
    .map((device, index) => ({ device, index, rank: rank(device) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)[0]?.device;
}

export function pickNativeAudioDevice(devices: MediaDeviceInfo[]) {
  return pickRankedDevice(devices, rankAudioDevice);
}

export function pickNativeVideoDevice(devices: MediaDeviceInfo[]) {
  return pickRankedDevice(devices, rankVideoDevice);
}
