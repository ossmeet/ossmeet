import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  useTracks,
  useParticipants,
  VideoTrack,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { ChevronRight, ChevronLeft, Users } from "lucide-react";
import { cn } from "@ossmeet/shared";

const STORAGE_KEY = "ossmeet.pip.position";
const MAX_VISIBLE = 4;
const TILE_SIZE = 120;
const EDGE_MARGIN = 12;

interface Position {
  right: number;
  top: number;
}

function getStoredPosition(): Position {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { right: EDGE_MARGIN, top: 72 };
}

function storePosition(pos: Position) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {}
}

export function FloatingVideoPip() {
  const [position, setPosition] = useState<Position>(getStoredPosition);
  const [collapsed, setCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; right: number; top: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get camera tracks (no screen share)
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const activeTracks = useMemo(
    () =>
      tracks
        .filter((t) => t.publication && !t.publication.isMuted)
        .sort((a, b) => {
          // Local first
          if (a.participant.isLocal && !b.participant.isLocal) return -1;
          if (!a.participant.isLocal && b.participant.isLocal) return 1;
          const aName = a.participant.name || a.participant.identity || "";
          const bName = b.participant.name || b.participant.identity || "";
          return aName.localeCompare(bName);
        }),
    [tracks]
  );

  const allParticipants = useParticipants();
  const totalCount = allParticipants.length;
  const visibleTracks = activeTracks.slice(0, MAX_VISIBLE);
  const overflowCount = totalCount - visibleTracks.length;

  // Drag handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        right: position.right,
        top: position.top,
      };
      setIsDragging(true);
    },
    [position]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const newRight = Math.max(
        EDGE_MARGIN,
        Math.min(
          window.innerWidth - TILE_SIZE - EDGE_MARGIN,
          dragStartRef.current.right - dx
        )
      );
      const newTop = Math.max(
        EDGE_MARGIN,
        Math.min(
          window.innerHeight - TILE_SIZE - EDGE_MARGIN,
          dragStartRef.current.top + dy
        )
      );
      setPosition({ right: newRight, top: newTop });
    },
    []
  );

  const handlePointerUp = useCallback(() => {
    if (dragStartRef.current) {
      setIsDragging(false);
      dragStartRef.current = null;
      setPosition((pos) => {
        storePosition(pos);
        return pos;
      });
    }
  }, []);

  // Re-clamp on resize
  useEffect(() => {
    const handleResize = () => {
      setPosition((pos) => {
        const clamped = {
          right: Math.max(EDGE_MARGIN, Math.min(window.innerWidth - TILE_SIZE - EDGE_MARGIN, pos.right)),
          top: Math.max(EDGE_MARGIN, Math.min(window.innerHeight - TILE_SIZE - EDGE_MARGIN, pos.top)),
        };
        storePosition(clamped);
        return clamped;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (totalCount <= 1 && activeTracks.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute z-25 select-none",
        isDragging ? "cursor-grabbing" : "cursor-grab",
        !isDragging && "transition-shadow duration-200"
      )}
      style={{
        right: position.right,
        top: position.top,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {collapsed ? (
        /* Collapsed state: small expand button */
        <button
          onClick={() => setCollapsed(false)}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-900/80 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-xl transition-all hover:bg-stone-900 hover:ring-white/20"
          title="Show video tiles"
        >
          <ChevronLeft className="h-4 w-4" />
          {totalCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent-500 px-1 text-2xs font-bold text-white">
              {totalCount}
            </span>
          )}
        </button>
      ) : (
        /* Expanded state: video tiles column */
        <div className="flex flex-col items-end gap-2">
          {/* Collapse button */}
          <button
            onClick={() => setCollapsed(true)}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-stone-900/80 text-neutral-400 shadow-md ring-1 ring-white/10 backdrop-blur-xl transition-all hover:bg-stone-900 hover:text-white"
            title="Collapse video tiles"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>

          {/* Video tiles */}
          {visibleTracks.map((trackRef) => {
            const name =
              trackRef.participant.name ||
              trackRef.participant.identity ||
              "Unknown";
            const isLocal = trackRef.participant.isLocal;

            return (
              <div
                key={trackRef.participant.identity}
                className="group relative overflow-hidden rounded-xl shadow-lg ring-1 ring-white/15"
                style={{ width: TILE_SIZE, height: Math.round(TILE_SIZE * 0.75) }}
              >
                <VideoTrack
                  trackRef={trackRef}
                  className={cn(
                    "h-full w-full object-cover",
                    isLocal && "-scale-x-100"
                  )}
                />
                {/* Name overlay on hover */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="text-2xs font-medium text-white">
                    {isLocal ? "You" : name}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Overflow badge */}
          {overflowCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg bg-stone-900/80 px-2.5 py-1.5 shadow-md ring-1 ring-white/10 backdrop-blur-xl">
              <Users className="h-3 w-3 text-neutral-400" />
              <span className="text-2xs font-medium text-neutral-300">
                +{overflowCount}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
