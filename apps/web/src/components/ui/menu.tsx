import { Menu as BaseMenu } from "@base-ui/react/menu";
import { cn } from "@ossmeet/shared";
import type { ReactNode, ReactElement } from "react";

export const MenuRoot = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;

export function MenuContent({
  children,
  className,
  side = "bottom",
  align = "end",
  sideOffset = 8,
}: {
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        positionMethod="fixed"
        collisionPadding={12}
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        className="z-(--z-popover) outline-hidden"
      >
        <BaseMenu.Popup
          className={cn(
            "min-w-[160px] rounded-xl border border-stone-200/80 bg-white/95 backdrop-blur-xl p-1.5 shadow-elevated outline-hidden",
            "origin-(--transform-origin) transition-[transform,scale,opacity] duration-150",
            "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className
          )}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

const itemBase =
  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-stone-600 outline-hidden select-none cursor-default transition-colors " +
  "data-[highlighted]:bg-stone-100/80 data-[highlighted]:text-stone-900 " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

export function MenuItem({
  children,
  className,
  onClick,
  disabled,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <BaseMenu.Item
      disabled={disabled}
      onClick={onClick}
      className={cn(itemBase, className)}
    >
      {children}
    </BaseMenu.Item>
  );
}

export function MenuLinkItem({
  children,
  className,
  render,
}: {
  children: ReactNode;
  className?: string;
  render: ReactElement;
}) {
  return (
    <BaseMenu.LinkItem render={render} className={cn(itemBase, className)}>
      {children}
    </BaseMenu.LinkItem>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return (
    <BaseMenu.Separator className={cn("my-1 mx-2 h-px bg-stone-100", className)} />
  );
}
