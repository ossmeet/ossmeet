import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactNode, ReactElement } from "react";

interface TooltipProps {
  content: string;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider>{children}</BaseTooltip.Provider>;
}

export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger className="inline-flex" render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          sideOffset={10}
          positionMethod="fixed"
          collisionPadding={12}
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        >
          <BaseTooltip.Popup className="pointer-events-none z-(--z-tooltip) max-w-48 rounded-lg bg-neutral-900 px-2.5 py-1.5 text-center text-xs leading-4 font-medium text-white shadow-lg origin-(--transform-origin) transition-[transform,scale,opacity] data-[instant]:transition-none data-[ending-style]:scale-90 data-[ending-style]:opacity-0 data-[starting-style]:scale-90 data-[starting-style]:opacity-0">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
