import type { CaptionLine } from "@/lib/meeting/use-livekit-captions";
import { cn } from "@ossmeet/shared";

interface CaptionOverlayProps {
  captions: CaptionLine[];
  className?: string;
}

const MAX_VISIBLE = 3;

/**
 * Pick the most recently updated caption per speaker, then keep the last
 * `MAX_VISIBLE` of those, oldest at the top so the newest caption appears
 * at the bottom near the user's eye line.
 */
export function getVisibleCaptionLines(captions: CaptionLine[], maxLines = MAX_VISIBLE): CaptionLine[] {
  const latestByUser = new Map<string, CaptionLine>();
  for (const line of captions) {
    if (!line.text.trim()) continue;
    const existing = latestByUser.get(line.userId);
    if (!existing || existing.updatedAt <= line.updatedAt) {
      latestByUser.set(line.userId, line);
    }
  }
  return [...latestByUser.values()]
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-maxLines);
}

/**
 * Anchored to the bottom-center of the meeting area. One pill per active
 * speaker. Interim captions render in italic until the speaker's segment
 * is finalized.
 */
export function CaptionOverlay({ captions, className }: CaptionOverlayProps) {
  const lines = getVisibleCaptionLines(captions);
  if (lines.length === 0) return null;

  return (
    <div
      role="log"
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        "pointer-events-none absolute left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-1",
        "bottom-[88px] max-w-[min(36rem,calc(100vw-2rem))]",
        className,
      )}
    >
      {lines.map((line) => (
        <div
          key={line.userId}
          className={cn(
            "rounded-full bg-black/70 px-4 py-1.5 text-sm leading-snug ring-1 ring-white/10 backdrop-blur-sm",
            !line.isFinal && "italic",
          )}
        >
          <span className={cn("font-medium", line.isFinal ? "text-primary-300" : "text-primary-300/70")}>
            {line.userName}
          </span>
          <span className="mx-1 text-white/40">:</span>
          <span className={line.isFinal ? "text-white/85" : "text-white/65"}>{line.text}</span>
        </div>
      ))}
    </div>
  );
}
