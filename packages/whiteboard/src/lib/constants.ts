/**
 * Whiteboard configuration
 *
 * CANONICAL PAGE SIZE: Fixed 4:3 aspect ratio (1200×900) for ALL devices.
 * This ensures content drawn on one device looks identical on another.
 * Each device auto-fits the page width using "fit-x" zoom strategy.
 */
export const WHITEBOARD_CONFIG = {
  // Canonical page dimensions (4:3 ratio) — same for ALL devices
  PAGE_WIDTH: 1200,
  PAGE_HEIGHT: 900,
  PAGE_SPACING: 40,
  CAMERA_PADDING: 40,

  // Page limits
  MAX_PAGES: 50,
} as const;
