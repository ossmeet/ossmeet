import { Popover as BasePopover } from "@base-ui/react/popover";
import { cn } from "@ossmeet/shared";
import type { ReactNode } from "react";
import React from "react";

export const PopoverRoot = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;
export const PopoverClose = BasePopover.Close;

export function PopoverContent({
  children,
  className,
  side = "bottom",
  sideOffset = 8,
  align = "center",
  anchor,
}: {
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  align?: "start" | "center" | "end";
  anchor?: React.RefObject<Element | null>;
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        anchor={anchor}
        positionMethod="fixed"
        collisionPadding={12}
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        className="z-(--z-popover)"
      >
        <BasePopover.Popup
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "pointer-events-auto",
            "origin-(--transform-origin) transition-[transform,scale,opacity]",
            "data-[instant]:transition-none",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            className
          )}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
