import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cn } from "@ossmeet/shared";
import type { ReactNode } from "react";

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </BaseDialog.Root>
  );
}

export const DialogTrigger = BaseDialog.Trigger;

type DialogSize = "sm" | "md" | "lg" | "xl";

const sizeMap: Record<DialogSize, string> = {
  sm: "24rem",
  md: "28rem",
  lg: "36rem",
  xl: "48rem",
};

export function DialogContent({
  children,
  className,
  size = "md",
}: {
  children: ReactNode;
  className?: string;
  size?: DialogSize;
  /** @deprecated Use size prop instead */
  maxWidth?: string;
}) {
  const maxWidth = sizeMap[size];
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 min-h-dvh z-50 bg-black/40 backdrop-blur-sm transition-all duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 supports-[-webkit-touch-callout:none]:absolute" />
      <BaseDialog.Popup
        className={cn(
          // Desktop: centered modal
          "fixed z-50 rounded-2xl bg-white shadow-elevated outline-0 focus-visible:outline-2 focus-visible:outline-accent-500 focus-visible:outline-offset-2 transition-all duration-200 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
          // Mobile < 640px: bottom sheet
          "inset-x-0 bottom-0 top-auto max-h-[85vh] overflow-y-auto rounded-b-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:max-h-[calc(100vh-4rem)]",
          className
        )}
        style={{ width: `min(${maxWidth}, calc(100vw - 2rem))` }}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-6 pt-6 pb-0", className)}>{children}</div>
  );
}

export function DialogFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-3 border-t border-neutral-100 px-6 py-4",
        className
      )}
    >
      {children}
    </div>
  );
}

export function DialogTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <BaseDialog.Title
      className={cn("text-lg font-semibold text-neutral-900", className)}
    >
      {children}
    </BaseDialog.Title>
  );
}

export function DialogDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <BaseDialog.Description
      className={cn("mt-1 text-sm text-neutral-500", className)}
    >
      {children}
    </BaseDialog.Description>
  );
}

export function DialogClose({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <BaseDialog.Close className={className}>{children}</BaseDialog.Close>
  );
}
