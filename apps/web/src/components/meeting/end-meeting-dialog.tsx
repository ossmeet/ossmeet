import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { X } from "lucide-react";

interface EndMeetingDialogProps {
  show: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  onLeave?: () => void | Promise<void>;
}

export function EndMeetingDialog({ show, onCancel, onConfirm, onLeave }: EndMeetingDialogProps) {
  const hasLeaveChoice = Boolean(onLeave);

  return (
    <Dialog open={show} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent size="sm" className="border border-neutral-200 bg-white shadow-elevated">
        <div className="relative px-6 pt-6 pb-4">
          <DialogClose
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogClose>
          <DialogTitle className="pr-8 text-neutral-900">
            {hasLeaveChoice ? "Leave meeting?" : "End meeting?"}
          </DialogTitle>
          <DialogDescription className="pr-8 text-neutral-600">
            {hasLeaveChoice
              ? "You can leave and let others continue, or end the meeting for everyone."
              : "This will end the meeting for all participants."}
          </DialogDescription>
        </div>
        <div className="flex flex-col gap-3 border-t border-neutral-100 px-6 py-4 sm:flex-row sm:justify-end">
          {onLeave && (
            <button
              onClick={onLeave}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
            >
              Leave meeting
            </button>
          )}
          <button
            onClick={onConfirm}
            className="rounded-lg bg-danger-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger-700"
          >
            End for all
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
