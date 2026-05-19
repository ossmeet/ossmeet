import { Drawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import { cn } from "@ossmeet/shared";
import type { ReactNode } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

export function BottomSheet({ open, onClose, children, title }: BottomSheetProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
      snapPoints={[0.75, 0.92]}
      defaultSnapPoint={0.75}
      swipeDirection="down"
      modal
    >
      <Drawer.Portal>
        <Drawer.Backdrop
          className="fixed inset-0 z-(--z-modal) bg-black/50 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <Drawer.Popup
          className={cn(
            "fixed inset-x-0 bottom-0 z-(--z-modal) flex flex-col rounded-t-2xl bg-neutral-900 shadow-2xl ring-1 ring-white/10 outline-hidden",
            "h-[92dvh]",
            // Apply snap-point offset + live swipe movement via CSS vars set by Base UI
            "[transform:translateY(calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))]",
            "transition-[transform] duration-300 ease-out",
            // Slide in from bottom on open, slide out on close
            "data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full",
            // No transition while actively dragging — keeps it responsive
            "data-[swiping]:transition-none",
          )}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {/* Drag handle — the whole popup is the swipe target; this is purely visual */}
          <div className="flex justify-center px-4 pt-3 pb-1 shrink-0">
            <div className="h-1 w-10 rounded-full bg-white/20" />
          </div>

          {title && (
            <div className="flex items-center justify-between px-4 pb-2 shrink-0">
              <Drawer.Title className="text-sm font-semibold text-white">{title}</Drawer.Title>
              <Drawer.Close
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10 cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4 text-neutral-400" />
              </Drawer.Close>
            </div>
          )}

          <Drawer.Content className="flex-1 overflow-hidden min-h-0">{children}</Drawer.Content>
        </Drawer.Popup>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
