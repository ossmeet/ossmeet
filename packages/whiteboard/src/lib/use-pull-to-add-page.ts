import { useEffect, useRef } from "react";

interface UsePullToAddPageOptions {
  enabled: boolean;
  ready: boolean;
  onAddPage?: () => void;
  idleDelayMs?: number;
  duplicateDelayMs?: number;
}

export function usePullToAddPage({
  enabled,
  ready,
  onAddPage,
  idleDelayMs = 320,
  duplicateDelayMs = 700,
}: UsePullToAddPageOptions): void {
  const readyRef = useRef(false);
  const onAddPageRef = useRef(onAddPage);
  const lastAddAtRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputKindRef = useRef<"pointer" | "wheel" | null>(null);

  readyRef.current = enabled && ready && !!onAddPage;
  onAddPageRef.current = onAddPage;

  useEffect(() => {
    if (!enabled || !onAddPage) return;

    const clearIdleTimer = () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };

    const addPageIfReady = () => {
      if (!readyRef.current) return;
      const now = Date.now();
      if (now - lastAddAtRef.current < duplicateDelayMs) return;
      lastAddAtRef.current = now;
      clearIdleTimer();
      onAddPageRef.current?.();
    };

    const scheduleIdleAdd = () => {
      if (!readyRef.current) return;
      clearIdleTimer();
      idleTimerRef.current = setTimeout(addPageIfReady, idleDelayMs);
    };

    const markPointerInput = () => {
      inputKindRef.current = "pointer";
    };
    const markWheelInput = () => {
      inputKindRef.current = "wheel";
      scheduleIdleAdd();
    };
    const handleRelease = () => {
      addPageIfReady();
      inputKindRef.current = null;
    };

    window.addEventListener("pointerdown", markPointerInput, true);
    window.addEventListener("touchstart", markPointerInput, true);
    window.addEventListener("pointerup", handleRelease, true);
    window.addEventListener("touchend", handleRelease, true);
    window.addEventListener("touchcancel", handleRelease, true);
    window.addEventListener("wheel", markWheelInput, { capture: true, passive: true });

    return () => {
      clearIdleTimer();
      inputKindRef.current = null;
      window.removeEventListener("pointerdown", markPointerInput, true);
      window.removeEventListener("touchstart", markPointerInput, true);
      window.removeEventListener("pointerup", handleRelease, true);
      window.removeEventListener("touchend", handleRelease, true);
      window.removeEventListener("touchcancel", handleRelease, true);
      window.removeEventListener("wheel", markWheelInput, true);
    };
  }, [duplicateDelayMs, enabled, idleDelayMs, onAddPage]);

}
