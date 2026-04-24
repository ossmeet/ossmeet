import { useEffect, useState } from "react";

type IdleCallbackHandle = number;

type IdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type IdleCallback = (deadline: IdleDeadline) => void;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleCallback, options?: { timeout?: number }) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
};

export function useIdleEnabled(timeout = 1200) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (enabled) return;

    const idleWindow = window as IdleWindow;

    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(() => {
        setEnabled(true);
      }, { timeout });

      return () => {
        idleWindow.cancelIdleCallback?.(handle);
      };
    }

    const handle = window.setTimeout(() => {
      setEnabled(true);
    }, timeout);

    return () => {
      window.clearTimeout(handle);
    };
  }, [enabled, timeout]);

  return enabled;
}
