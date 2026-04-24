import * as React from "react";
import type { CaptionLine } from "@/lib/meeting/use-livekit-captions";
import { cn } from "@ossmeet/shared";

interface CaptionOverlayProps {
  captions: CaptionLine[];
  captionHistory?: CaptionLine[];
  className?: string;
}

/**
 * Displays recent captions as a scrollable list anchored to the bottom-center
 * of the meeting area. The drag handle at the top lets the user reposition it.
 * Auto-scrolls to the latest line on new content.
 */
export function CaptionOverlay({ captions, captionHistory = [] }: CaptionOverlayProps) {
  const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef<{
    startX: number;
    startY: number;
    ox: number;
    oy: number;
  } | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const finalHistory = captionHistory.filter((line) => line.text);
  const interim = captions.find((line) => line.text && !line.isFinal);

  // Show only the single most recent line: interim if active, otherwise last finalized
  const activeLine = interim?.text ? interim : finalHistory[finalHistory.length - 1];

  if (!activeLine?.text) return null;

  const handleDragPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      ox: dragOffset.x,
      oy: dragOffset.y,
    };
  };

  const handleDragPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setDragOffset({
      x: dragRef.current.ox + (e.clientX - dragRef.current.startX),
      y: dragRef.current.oy + (e.clientY - dragRef.current.startY),
    });
  };

  const handleDragPointerUp = () => {
    dragRef.current = null;
    setIsDragging(false);
  };

  return (
    <div
      role="log"
      aria-live="polite"
      aria-atomic="false"
      className="absolute z-40 flex flex-col items-center select-none"
      style={{
        left: "50%",
        bottom: "76px",
        transform: `translate(calc(-50% + ${dragOffset.x}px), ${dragOffset.y}px)`,
      }}
    >
      {/* Drag handle — only this bar initiates repositioning */}
      <div
        className={cn(
          "mb-1 flex w-full justify-center py-1 touch-none",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
      >
        <div className="h-0.5 w-8 rounded-full bg-white/25" />
      </div>

      {/* Single current caption line */}
      <div
        className={cn(
          "max-w-lg rounded-full bg-black/70 backdrop-blur-sm px-4 py-2 text-sm ring-1 ring-white/10",
          !activeLine.isFinal && "italic"
        )}
      >
        <span className={cn("font-medium", activeLine.isFinal ? "text-primary-300" : "text-primary-300/70")}>
          {activeLine.userName}
        </span>
        <span className={cn("mx-1", activeLine.isFinal ? "text-white/40" : "text-white/30")}>:</span>
        <span className={activeLine.isFinal ? "text-white/80" : "text-white/60"}>{activeLine.text}</span>
      </div>
    </div>
  );
}
