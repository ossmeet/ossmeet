import { Hand, Check, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HandRaise } from "@/lib/meeting/use-livekit-hand-raises";
import { cn } from "@ossmeet/shared";

export function HandRaisePanel({
  queue,
  onApprove,
  onDismiss,
  onClose,
  className,
}: {
  queue: HandRaise[];
  onApprove: (userId: string) => void;
  onDismiss: (userId: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const pendingQueue = queue
    .filter((entry) => entry.status === "pending")
    .sort((a, b) => a.raisedAt - b.raisedAt);

  const formatWaitTime = (raisedAt: number) => {
    const diffSeconds = Math.max(
      0,
      Math.floor((Date.now() - raisedAt) / 1000)
    );
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const mins = Math.floor(diffSeconds / 60);
    return `${mins}m ago`;
  };

  return (
    <div
      className={cn(
        "flex flex-col w-80 overflow-hidden rounded-xl bg-white shadow-[0_8px_32px_-8px_rgba(0,0,0,0.15)] border border-stone-200 animate-panel-slide-in",
        className
      )}
    >
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-stone-100 bg-stone-50/50">
        <h2 className="font-semibold text-stone-800 text-sm flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 border border-amber-100">
            <Hand className="w-4 h-4 text-amber-600" />
          </div>
          Hand Raise Queue
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
          aria-label="Close hand raise queue"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-2 border-b border-stone-100 text-xs text-stone-500 bg-white">
        Pending: {pendingQueue.length}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-stone-50/30">
        {pendingQueue.length === 0 ? (
          <div className="h-full min-h-48 flex flex-col items-center justify-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-stone-100 border border-stone-200 mb-3">
              <Hand className="w-6 h-6 text-stone-300" />
            </div>
            <p className="text-sm font-medium text-stone-600">No pending hand raises</p>
            <p className="text-xs mt-1 text-stone-400">
              Participants who raise their hand will appear here.
            </p>
          </div>
        ) : (
          pendingQueue.map((entry, index) => (
            <div
              key={entry.nonce}
              className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-stone-700 truncate">
                    {entry.userName}
                  </p>
                  <p className="text-xs text-stone-400 mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatWaitTime(entry.raisedAt)}
                  </p>
                </div>
                <span className="text-2xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100 shrink-0">
                  #{index + 1}
                </span>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  className="flex-1 h-9"
                  onClick={() => onApprove(entry.userId)}
                >
                  <Check className="w-4 h-4 mr-1" />
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1 h-9"
                  onClick={() => onDismiss(entry.userId)}
                >
                  <X className="w-4 h-4 mr-1" />
                  Dismiss
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
