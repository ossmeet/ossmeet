import { getSpeechRecognitionConstructor } from "./speech-recognition-support";
import { getPlatformInfo } from "@/lib/platform";

let _done = false;
let _promise: Promise<void> | null = null;

export function isSpeechWarmUpDone(): boolean {
  return _done;
}

/**
 * On iOS/iPadOS Safari, the first SpeechRecognition.start() on a cold
 * WebContent process crashes Safari (PAC_EXCEPTION in
 * SpeechRecognitionServer::messageSenderConnection). Running a brief
 * probe forces WebKit to establish the IPC channel before LiveKit/WebRTC
 * add memory pressure.
 */
export function warmUpSpeechRecognition(): Promise<void> {
  if (_done) return Promise.resolve();
  if (_promise) return _promise;

  const { os } = getPlatformInfo();
  if (os !== "ipados" && os !== "ios") {
    _done = true;
    return Promise.resolve();
  }

  const Ctor = getSpeechRecognitionConstructor();
  if (!Ctor) {
    _done = true;
    return Promise.resolve();
  }

  _promise = new Promise<void>((resolve) => {
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en";

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rec.onstart = null;
      rec.onend = null;
      rec.onerror = null;
      rec.onresult = null;
      try {
        rec.abort();
      } catch {}
      _done = true;
      resolve();
    };

    rec.onstart = () => {
      try {
        rec.abort();
      } catch {}
    };

    rec.onend = finish;
    rec.onerror = () => {};

    const timeout = setTimeout(finish, 5_000);

    try {
      rec.start();
    } catch {
      finish();
    }
  });

  return _promise;
}
