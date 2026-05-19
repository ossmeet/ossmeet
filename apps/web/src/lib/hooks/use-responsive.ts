import { useSyncExternalStore } from "react";

export type DeviceMode = "phone" | "tablet" | "desktop";
export type Orientation = "portrait" | "landscape";

export interface ResponsiveState {
  mode: DeviceMode;
  orientation: Orientation;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isLandscape: boolean;
  /** True on phone only — most space-constrained */
  isCompact: boolean;
  /** True on phone landscape — controls should auto-hide */
  controlBarAutoHide: boolean;
  /** True on phone — panels should render as bottom sheets */
  useBottomSheet: boolean;
  /** True on desktop or tablet landscape — show video sidebar */
  showVideoSidebar: boolean;
  /** True on phone or tablet portrait — show compact video strip overlay */
  showParticipantStrip: boolean;
}

const PHONE_MAX = 640;
const TABLET_MAX = 1024;

function computeState(): ResponsiveState {
  if (typeof window === "undefined") return DESKTOP_DEFAULT;

  const w = window.innerWidth;
  const h = window.innerHeight;
  const isLandscape = w > h;

  // Phone: narrow viewport OR very short height in landscape (phone rotated)
  const isPhone = w < PHONE_MAX || (isLandscape && h < 480);
  const isTablet = !isPhone && w < TABLET_MAX;
  const isDesktop = !isPhone && !isTablet;

  const mode: DeviceMode = isPhone ? "phone" : isTablet ? "tablet" : "desktop";

  return {
    mode,
    orientation: isLandscape ? "landscape" : "portrait",
    isPhone,
    isTablet,
    isDesktop,
    isLandscape,
    isCompact: isPhone,
    controlBarAutoHide: isPhone && isLandscape,
    useBottomSheet: isPhone,
    showVideoSidebar: isDesktop || (isTablet && isLandscape),
    showParticipantStrip: isPhone || (isTablet && !isLandscape),
  };
}

const DESKTOP_DEFAULT: ResponsiveState = {
  mode: "desktop",
  orientation: "landscape",
  isPhone: false,
  isTablet: false,
  isDesktop: true,
  isLandscape: true,
  isCompact: false,
  controlBarAutoHide: false,
  useBottomSheet: false,
  showVideoSidebar: true,
  showParticipantStrip: false,
};

let cache: ResponsiveState | null = null;
const listeners = new Set<() => void>();

function notify() {
  cache = null; // invalidate
  listeners.forEach((cb) => cb());
}

function subscribe(callback: () => void) {
  listeners.add(callback);

  // Set up listeners once (on first subscriber)
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("resize", notify);
    window.addEventListener("orientationchange", notify);
  }

  return () => {
    listeners.delete(callback);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("resize", notify);
      window.removeEventListener("orientationchange", notify);
    }
  };
}

function getSnapshot(): ResponsiveState {
  if (typeof window === "undefined") return DESKTOP_DEFAULT;
  if (!cache) cache = computeState();
  return cache;
}

function getServerSnapshot(): ResponsiveState {
  return DESKTOP_DEFAULT;
}

export function useResponsive(): ResponsiveState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
