import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Radio,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { WhiteboardPage } from "../lib/page-manager";

interface ConnectedUser {
  userId: string;
  userName: string;
}

interface WhiteboardViewportControlsProps {
  isMobileLandscape: boolean;
  canEditCanvas: boolean;
  pages: WhiteboardPage[];
  currentPage: number;
  zoomPercent: number;
  onPageChange: (pageNumber: number) => void;
  onAddPage?: () => void;
  onInsertPageAfter?: (afterPageNumber: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToPage: () => void;
  // Navigation control hand-off
  canManageNavigation?: boolean;
  isNavigationController?: boolean;
  myUserId?: string | null;
  navigationControllerName?: string | null;
  connectedUsers?: ConnectedUser[];
  onSetNavigationController?: (targetUserId: string) => Promise<void>;
  onReleaseNavigationController?: () => Promise<void>;
}

export function WhiteboardViewportControls({
  isMobileLandscape,
  canEditCanvas,
  pages,
  currentPage,
  zoomPercent,
  onPageChange,
  onAddPage,
  onInsertPageAfter,
  onZoomIn,
  onZoomOut,
  onZoomToPage,
  canManageNavigation = false,
  isNavigationController = false,
  myUserId = null,
  navigationControllerName = null,
  connectedUsers = [],
  onSetNavigationController,
  onReleaseNavigationController,
}: WhiteboardViewportControlsProps) {
  const [showHandoffMenu, setShowHandoffMenu] = useState(false);

  const isLastPage = currentPage >= pages.length;

  const handleInsert = () => {
    if (onInsertPageAfter) {
      onInsertPageAfter(currentPage);
    } else if (onAddPage) {
      onAddPage();
    }
  };

  const handleSetNavigationController = async (userId: string) => {
    setShowHandoffMenu(false);
    try {
      await onSetNavigationController?.(userId);
    } catch (err) {
      console.error("Failed to set navigation controller:", err);
    }
  };

  const handleReleaseNavigationController = async () => {
    try {
      await onReleaseNavigationController?.();
    } catch (err) {
      console.error("Failed to release navigation controller:", err);
    }
  };

  // Users the manager can hand off to — exclude themselves so they can't assign themselves.
  const handoffCandidates = connectedUsers.filter((u) => u.userId !== myUserId);

  const hasActiveNavigationController = navigationControllerName !== null;

  return (
    <div
      className={cn(
        "whiteboard-viewport-controls flex items-center gap-2",
        isMobileLandscape && "gap-1"
      )}
    >
      {/* ── Navigation control status pill ─────────────────────────────────── */}
      {hasActiveNavigationController && (
        <div className="flex items-center gap-1.5 bg-indigo-600/90 backdrop-blur-xl border border-indigo-500/50 shadow-sm rounded-full px-3 py-1 md:py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-200 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
          </span>
          <span className="text-xs md:text-sm font-medium text-white whitespace-nowrap">
            {isNavigationController ? "You control navigation" : `${navigationControllerName} controls navigation`}
          </span>
          {/* Stop button — visible to the navigation controller and whiteboard managers */}
          {(isNavigationController || canManageNavigation) && onReleaseNavigationController && (
            <button
              type="button"
              onClick={handleReleaseNavigationController}
              className="ml-0.5 w-4 h-4 rounded-full flex items-center justify-center text-indigo-200 hover:text-white hover:bg-indigo-500 transition-colors"
              aria-label="Release navigation control"
              title={isNavigationController ? "Release navigation control" : "Reclaim navigation control"}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* ── Zoom controls pill ───────────────────────────────────── */}
      <div className="bg-white/80 backdrop-blur-xl border border-black/5 shadow-sm rounded-full flex items-center px-2 py-1 md:px-3 md:py-1.5 gap-1.5">
        <button
          type="button"
          onClick={onZoomOut}
          className="w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
          aria-label="Zoom out"
        >
          <Minus className="w-[14px] h-[14px]" />
        </button>

        <button
          type="button"
          onClick={onZoomToPage}
          className="font-semibold text-stone-600 tabular-nums hover:text-stone-900 transition-colors flex items-center justify-center min-w-[3rem] text-xs md:text-sm"
          title="Fit page"
        >
          {zoomPercent}%
        </button>

        <button
          type="button"
          onClick={onZoomIn}
          className="w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
          aria-label="Zoom in"
        >
          <Plus className="w-[14px] h-[14px]" />
        </button>
      </div>

      {/* ── Page navigation pill ─────────────────────────────────── */}
      <div className="bg-white/80 backdrop-blur-xl border border-black/5 shadow-sm rounded-full flex items-center px-2 py-1 md:px-3 md:py-1.5 gap-1">
        {/* Previous page */}
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="w-6 h-6 md:w-7 md:h-7 rounded flex shrink-0 items-center justify-center text-stone-500 hover:text-stone-800 hover:bg-stone-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Page count */}
        <span className="font-semibold text-stone-600 tabular-nums text-xs md:text-sm px-1 shrink-0">
          {currentPage} / {Math.max(pages.length, 1)}
        </span>

        {/* Insert page after current — always visible for editors */}
        {canEditCanvas && (onInsertPageAfter || onAddPage) && (
          <button
            type="button"
            onClick={handleInsert}
            className="w-6 h-6 md:w-7 md:h-7 rounded flex shrink-0 items-center justify-center text-primary-600 hover:text-primary-700 hover:bg-primary-50 transition-colors"
            aria-label="Insert page after current"
            title="Insert page after current"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}

        {/* Next page */}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(Math.max(pages.length, 1), currentPage + 1))}
          disabled={isLastPage}
          className="w-6 h-6 md:w-7 md:h-7 rounded flex shrink-0 items-center justify-center text-stone-500 hover:text-stone-800 hover:bg-stone-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* Manager-only: hand off navigation control */}
        {canManageNavigation && !hasActiveNavigationController && onSetNavigationController && handoffCandidates.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowHandoffMenu((v) => !v)}
              className="w-6 h-6 md:w-7 md:h-7 rounded flex shrink-0 items-center justify-center text-stone-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              aria-label="Hand off navigation to a participant"
              title="Hand off navigation control"
            >
              <Radio className="w-4 h-4" />
            </button>

            {showHandoffMenu && (
              <>
                {/* Backdrop to close menu */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowHandoffMenu(false)}
                />
                <div className="absolute bottom-full right-0 mb-2 z-50 min-w-[160px] max-w-[220px] rounded-xl bg-white border border-stone-200 shadow-xl overflow-hidden">
                  <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                    Hand off to
                  </p>
                  <ul className="pb-1.5">
                    {handoffCandidates.map((user) => (
                      <li key={user.userId}>
                        <button
                          type="button"
                          onClick={() => handleSetNavigationController(user.userId)}
                          className="w-full text-left px-3 py-1.5 text-sm text-stone-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors truncate"
                        >
                          {user.userName}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
