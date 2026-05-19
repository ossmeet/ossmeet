/**
 * Platform Detection Utilities
 *
 * Uses feature detection (NOT user-agent sniffing) to determine platform
 * capabilities. This is more reliable and future-proof.
 */

import { useEffect, useSyncExternalStore } from "react";

// ================================================
// TYPES
// ================================================

export type OSType =
  | "android"
  | "ios"
  | "ipados"
  | "windows"
  | "macos"
  | "linux"
  | "unknown";
export type BrowserEngine = "blink" | "webkit" | "gecko" | "unknown";
export type InputType = "touch" | "pointer" | "hybrid";

export interface PlatformInfo {
  os: OSType;
  engine: BrowserEngine;
  input: InputType;
  canHover: boolean;
  prefersReducedMotion: boolean;
  isPWA: boolean;
  isHighDPI: boolean;
  isMobileViewport: boolean;
}

// ================================================
// FEATURE DETECTION HELPERS
// ================================================

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function matchMediaQuery(query: string): boolean {
  if (!isBrowser()) return false;
  return window.matchMedia(query).matches;
}

function detectEngine(): BrowserEngine {
  if (!isBrowser()) return "unknown";

  if (
    CSS.supports("-webkit-backdrop-filter", "blur(1px)") &&
    !CSS.supports("scrollbar-color", "auto")
  ) {
    return "webkit";
  }

  if (
    CSS.supports("scrollbar-color", "auto") &&
    CSS.supports("-moz-appearance", "none")
  ) {
    return "gecko";
  }

  if (CSS.supports("backdrop-filter", "blur(1px)")) {
    return "blink";
  }

  return "unknown";
}

function detectOS(): OSType {
  if (!isBrowser()) return "unknown";

  const hasTouch =
    "ontouchstart" in window || navigator.maxTouchPoints > 0;

  const uaData = (navigator as any).userAgentData;
  if (uaData?.platform) {
    const platform = uaData.platform.toLowerCase();
    if (platform === "android") return "android";
    if (platform === "ios") return "ios";
    if (platform === "windows") return "windows";
    if (platform === "macos") return "macos";
    if (platform === "linux") return "linux";
  }

  const platform = navigator.platform?.toLowerCase() || "";
  const ua = navigator.userAgent?.toLowerCase() || "";

  if (/iphone|ipod/.test(ua)) return "ios";
  if (/ipad/.test(ua) || (platform === "macintel" && hasTouch))
    return "ipados";
  if (/android/.test(ua)) return "android";
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  if (platform.includes("linux")) return "linux";

  return "unknown";
}

function detectInputType(): InputType {
  if (!isBrowser()) return "pointer";

  const hasCoarsePointer = matchMediaQuery("(pointer: coarse)");
  const hasFinePointer = matchMediaQuery("(pointer: fine)");
  const hasAnyCoarse = matchMediaQuery("(any-pointer: coarse)");
  const hasAnyFine = matchMediaQuery("(any-pointer: fine)");

  if (
    (hasFinePointer && hasAnyCoarse) ||
    (hasCoarsePointer && hasAnyFine)
  ) {
    return "hybrid";
  }

  if (hasCoarsePointer) return "touch";

  return "pointer";
}

// ================================================
// MAIN DETECTION FUNCTION
// ================================================

export function getPlatformInfo(): PlatformInfo {
  if (!isBrowser()) {
    return {
      os: "unknown",
      engine: "unknown",
      input: "pointer",
      canHover: true,
      prefersReducedMotion: false,
      isPWA: false,
      isHighDPI: false,
      isMobileViewport: false,
    };
  }

  return {
    os: detectOS(),
    engine: detectEngine(),
    input: detectInputType(),
    canHover: matchMediaQuery("(hover: hover)"),
    prefersReducedMotion: matchMediaQuery(
      "(prefers-reduced-motion: reduce)"
    ),
    isPWA:
      matchMediaQuery("(display-mode: standalone)") ||
      matchMediaQuery("(display-mode: fullscreen)") ||
      (window.navigator as any).standalone === true,
    isHighDPI: window.devicePixelRatio > 1.5,
    isMobileViewport: matchMediaQuery("(max-width: 768px)"),
  };
}

// ================================================
// REACT HOOKS
// ================================================

let platformInfoCache: PlatformInfo | null = null;
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): PlatformInfo {
  if (typeof window === "undefined") {
    return getPlatformInfo();
  }
  if (!platformInfoCache) {
    platformInfoCache = getPlatformInfo();
  }
  return platformInfoCache;
}

function getServerSnapshot(): PlatformInfo {
  return getPlatformInfo();
}

export function usePlatform(): PlatformInfo {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function usePlatformClasses(): void {
  useEffect(() => {
    const info = getPlatformInfo();
    const html = document.documentElement;

    const classes = [
      `platform-${info.os}`,
      `engine-${info.engine}`,
      `input-${info.input}`,
      info.canHover && "can-hover",
      info.prefersReducedMotion && "reduced-motion",
      info.isPWA && "pwa-standalone",
      info.isHighDPI && "high-dpi",
      info.isMobileViewport && "mobile-viewport",
    ].filter(Boolean) as string[];

    html.classList.add(...classes);

    const mediaQueries = [
      {
        query: "(prefers-reduced-motion: reduce)",
        class: "reduced-motion",
      },
      { query: "(display-mode: standalone)", class: "pwa-standalone" },
      { query: "(max-width: 768px)", class: "mobile-viewport" },
    ];

    const cleanups = mediaQueries.map(({ query, class: className }) => {
      const mq = window.matchMedia(query);
      const handler = (e: MediaQueryListEvent) => {
        if (e.matches) {
          html.classList.add(className);
        } else {
          html.classList.remove(className);
        }
      };
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    });

    return () => {
      html.classList.remove(...classes);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);
}

// ================================================
// UTILITY FUNCTIONS
// ================================================

export function isTouchDevice(): boolean {
  return getPlatformInfo().input !== "pointer";
}

export function isIOS(): boolean {
  return getPlatformInfo().os === "ios";
}

export function isApple(): boolean {
  const os = getPlatformInfo().os;
  return os === "ios" || os === "ipados" || os === "macos";
}
