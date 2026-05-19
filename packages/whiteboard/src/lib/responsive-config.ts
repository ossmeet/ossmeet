/**
 * Responsive whiteboard configuration
 *
 * CANONICAL PAGE SIZE: All devices use the same fixed 4:3 page (1200×900).
 * Each device auto-fits the page width using "fit-x" zoom strategy via tldraw
 * camera constraints.
 */

import { WHITEBOARD_CONFIG } from "./constants";

const { PAGE_WIDTH, PAGE_HEIGHT, PAGE_SPACING, CAMERA_PADDING } = WHITEBOARD_CONFIG;

export const BREAKPOINTS = {
  MOBILE_PORTRAIT_MAX: 480,
  MOBILE_LANDSCAPE_MAX: 500,
  TABLET_MAX: 1024,
  DESKTOP_LANDSCAPE_MIN_WIDTH: 1280,
  DESKTOP_LANDSCAPE_MIN_HEIGHT: 720,
} as const;

export type ViewportCategory =
  | "mobile-portrait"
  | "mobile-landscape"
  | "tablet"
  | "desktop";

export interface ViewportInfo {
  width: number;
  height: number;
  category: ViewportCategory;
  isPortrait: boolean;
  aspectRatio: number;
}

export interface PageDimensions {
  width: number;
  height: number;
  aspectRatio: number;
  category: ViewportCategory;
}

export function getViewportCategory(viewport: { width: number; height: number }): ViewportCategory {
  const { width, height } = viewport;
  const isPortrait = height > width;
  const minDimension = Math.min(width, height);

  if (isPortrait && minDimension < BREAKPOINTS.MOBILE_PORTRAIT_MAX) {
    return "mobile-portrait";
  }
  if (!isPortrait && height < BREAKPOINTS.MOBILE_LANDSCAPE_MAX) {
    return "mobile-landscape";
  }
  if (
    !isPortrait &&
    width >= BREAKPOINTS.DESKTOP_LANDSCAPE_MIN_WIDTH &&
    height >= BREAKPOINTS.DESKTOP_LANDSCAPE_MIN_HEIGHT
  ) {
    return "desktop";
  }
  if (minDimension < BREAKPOINTS.TABLET_MAX) {
    return "tablet";
  }
  return "desktop";
}

export function getViewportInfo(viewport: { width: number; height: number }): ViewportInfo {
  const { width, height } = viewport;
  return {
    width,
    height,
    category: getViewportCategory(viewport),
    isPortrait: height > width,
    aspectRatio: width / height,
  };
}

export function calculatePageDimensions(viewport: { width: number; height: number }): PageDimensions {
  return {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    aspectRatio: PAGE_WIDTH / PAGE_HEIGHT,
    category: getViewportCategory(viewport),
  };
}

export function calculateCameraPadding(viewport: { width: number; height: number }): number {
  const category = getViewportCategory(viewport);
  switch (category) {
    case "mobile-portrait":
    case "mobile-landscape":
      return Math.max(16, Math.round(CAMERA_PADDING * 0.5));
    case "tablet":
      return Math.max(24, Math.round(CAMERA_PADDING * 0.75));
    default:
      return CAMERA_PADDING;
  }
}

export function getResponsiveConfig(viewport: { width: number; height: number }) {
  return {
    viewport: getViewportInfo(viewport),
    page: calculatePageDimensions(viewport),
    pageSpacing: PAGE_SPACING,
    cameraPadding: calculateCameraPadding(viewport),
  };
}
