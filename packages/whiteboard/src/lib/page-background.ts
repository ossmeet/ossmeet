import type { CSSProperties } from "react";

export type PageBackground =
  | "white"
  | "white-dots"
  | "white-lines"
  | "white-grid"
  | "dark"
  | "dark-dots"
  | "dark-lines"
  | "dark-grid";

export const DEFAULT_PAGE_BACKGROUND: PageBackground = "white";

export interface PageBackgroundOption {
  value: PageBackground;
  label: string;
  isDark: boolean;
}

export const PAGE_BACKGROUND_OPTIONS: PageBackgroundOption[] = [
  { value: "white", label: "Plain", isDark: false },
  { value: "white-dots", label: "Dots", isDark: false },
  { value: "white-lines", label: "Lines", isDark: false },
  { value: "white-grid", label: "Grid", isDark: false },
  { value: "dark", label: "Dark", isDark: true },
  { value: "dark-dots", label: "Dark Dots", isDark: true },
  { value: "dark-lines", label: "Dark Lines", isDark: true },
  { value: "dark-grid", label: "Dark Grid", isDark: true },
];

const VALID_BACKGROUNDS = new Set<string>([
  "white",
  "white-dots",
  "white-lines",
  "white-grid",
  "dark",
  "dark-dots",
  "dark-lines",
  "dark-grid",
]);

export function parsePageBackground(value: unknown): PageBackground {
  if (typeof value === "string" && VALID_BACKGROUNDS.has(value)) {
    return value as PageBackground;
  }
  return DEFAULT_PAGE_BACKGROUND;
}

const DOT_LIGHT = "rgba(0,0,0,0.18)";
const DOT_DARK = "rgba(255,255,255,0.14)";
const LINE_LIGHT = "rgba(0,0,0,0.1)";
const LINE_DARK = "rgba(255,255,255,0.08)";

export function getBackgroundStyle(
  bg: PageBackground,
  /** Scale factor for background-size (use <1 for preview thumbnails) */
  scale = 1
): CSSProperties {
  const gridSize = Math.round(60 * scale);
  const lineSpacing = Math.round(40 * scale);

  switch (bg) {
    case "white":
      return { background: "#ffffff" };

    case "white-dots":
      return {
        background: "#ffffff",
        backgroundImage: `radial-gradient(circle, ${DOT_LIGHT} 1.5px, transparent 1.5px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
      };

    case "white-lines":
      return {
        background: "#fafaf9",
        backgroundImage: `linear-gradient(to bottom, transparent calc(${lineSpacing}px - 1px), ${LINE_LIGHT} 1px)`,
        backgroundSize: `100% ${lineSpacing}px`,
      };

    case "white-grid":
      return {
        background: "#ffffff",
        backgroundImage: [
          `linear-gradient(to right, ${LINE_LIGHT} 1px, transparent 1px)`,
          `linear-gradient(to bottom, ${LINE_LIGHT} 1px, transparent 1px)`,
        ].join(", "),
        backgroundSize: `${gridSize}px ${gridSize}px`,
      };

    case "dark":
      return { background: "#111111" };

    case "dark-dots":
      return {
        background: "#111111",
        backgroundImage: `radial-gradient(circle, ${DOT_DARK} 1.5px, transparent 1.5px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
      };

    case "dark-lines":
      return {
        background: "#111111",
        backgroundImage: `linear-gradient(to bottom, transparent calc(${lineSpacing}px - 1px), ${LINE_DARK} 1px)`,
        backgroundSize: `100% ${lineSpacing}px`,
      };

    case "dark-grid":
      return {
        background: "#111111",
        backgroundImage: [
          `linear-gradient(to right, ${LINE_DARK} 1px, transparent 1px)`,
          `linear-gradient(to bottom, ${LINE_DARK} 1px, transparent 1px)`,
        ].join(", "),
        backgroundSize: `${gridSize}px ${gridSize}px`,
      };

    default:
      return { background: "#ffffff" };
  }
}
