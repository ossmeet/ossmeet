import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";

interface LeavePdfDialogProps {
  leavePhase: null | "prompting" | "exporting";
  exportChoiceRef: React.RefObject<((choice: boolean) => void) | null>;
  exportProgress: string | null;
  onSkip: () => void;
}

export function LeavePdfDialog({ leavePhase, exportChoiceRef, exportProgress, onSkip }: LeavePdfDialogProps) {
  if (leavePhase === "prompting") {
    return (
      <Dialog open onOpenChange={(open) => !open && onSkip()}>
        <DialogContent size="sm" className="bg-stone-900 border border-white/10 shadow-xl">
          <div className="px-6 pt-6 pb-4">
            <DialogTitle className="text-white">Download whiteboard PDF?</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Save a copy of the whiteboard before leaving.
            </DialogDescription>
          </div>
          <div className="flex justify-end gap-3 border-t border-white/10 px-6 py-4">
            <DialogClose className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-stone-800">
              Skip
            </DialogClose>
            <button
              onClick={() => exportChoiceRef.current?.(true)}
              className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-600"
            >
              Download PDF
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (leavePhase === "exporting") {
    // Non-interactive blocking overlay — kept as a plain div intentionally.
    // No focus management needed; there are no interactive elements.
    return (
      <div
        role="status"
        aria-label="Exporting whiteboard"
        aria-live="polite"
        className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/95 backdrop-blur-sm"
      >
        <div className="space-y-4 px-6 text-center">
          <div className="relative mx-auto h-16 w-16">
            <div className="absolute inset-0 rounded-full border-4 border-white/10" />
            <div className="absolute inset-0 animate-spin rounded-full border-4 border-t-accent-400" />
            <div className="absolute inset-0 flex items-center justify-center">
              <svg
                className="h-6 w-6 text-accent-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="12" y2="18" />
                <line x1="15" y1="15" x2="12" y2="18" />
              </svg>
            </div>
          </div>
          <div>
            <p className="text-lg font-semibold text-white">Exporting whiteboard…</p>
            <p className="mt-1 text-sm text-white/50">{exportProgress ?? "Preparing your PDF…"}</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
