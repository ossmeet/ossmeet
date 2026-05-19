import { Table2 } from "lucide-react";

export function GeoToolIcon({ geoType }: { geoType: string }) {
  const size = 18;
  switch (geoType) {
    case "rectangle":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="18" height="13" rx="2" />
        </svg>
      );
    case "ellipse":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="12" rx="10" ry="7" />
        </svg>
      );
    case "diamond":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 3 21 12 12 21 3 12" />
        </svg>
      );
    default:
      return null;
  }
}

export function ToolIcon({
  toolId,
  compact,
  isStrokeEraser = false,
}: {
  toolId: string;
  compact?: boolean;
  isStrokeEraser?: boolean;
}) {
  const size = compact ? 18 : 22;
  switch (toolId) {
    case "select":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M5 3l14 8-6 2-4 6-4-16z" />
        </svg>
      );
    case "draw":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      );
    case "eraser":
    case "stroke-eraser":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
          <path d="M22 21H7" />
          <path d="m5 11 9 9" />
          {isStrokeEraser && <path d="M3 7c2.5 0 3.5 1.5 6 1.5S12.5 7 15 7" />}
        </svg>
      );
    case "text":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 7 4 4 20 4 20 7" />
          <line x1="9" y1="20" x2="15" y2="20" />
          <line x1="12" y1="4" x2="12" y2="20" />
        </svg>
      );
    case "arrow":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      );
    case "highlight":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 2l4 4-9.5 9.5-4-4L18 2z" />
          <path d="M8.5 11.5l4 4" />
          <path d="M4.5 15.5L2 22l6.5-2.5" />
          <path d="M2 22l6.5-2.5-4-4L2 22z" fill="currentColor" opacity="0.3" />
        </svg>
      );
    case "screenshot":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2" />
          <path d="M9 9l6 6M15 9l-6 6" strokeWidth="1.5" />
        </svg>
      );
    case "laser":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="15" r="3.5" fill="currentColor" stroke="none" />
          <path d="M13.5 10.5 20 4" />
          <path d="m17 4 3 3" />
        </svg>
      );
    case "table":
      return <Table2 className={compact ? "w-[18px] h-[18px]" : "w-[22px] h-[22px]"} />;
    default:
      return null;
  }
}
