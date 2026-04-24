import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { cn } from "@ossmeet/shared";
import type { ReactNode } from "react";

const sizes = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-lg",
};

const bgColors = [
  "bg-teal-100 text-teal-700",
  "bg-amber-100 text-amber-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-orange-100 text-orange-700",
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (name[0] || "?").toUpperCase();
}

interface AvatarProps {
  name: string;
  image?: string | null;
  size?: keyof typeof sizes;
  online?: boolean;
  className?: string;
}

export function Avatar({
  name,
  image,
  size = "md",
  online,
  className,
}: AvatarProps) {
  const colorIndex = hashName(name) % bgColors.length;

  const statusDot =
    online !== undefined ? (
      <span
        className={cn(
          "absolute bottom-0 right-0 block rounded-full ring-2 ring-white",
          size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5",
          online ? "bg-emerald-500" : "bg-neutral-400"
        )}
      />
    ) : null;

  return (
    <div className="relative shrink-0">
      <BaseAvatar.Root
        aria-label={name}
        className={cn(
          "inline-flex items-center justify-center rounded-full overflow-hidden font-medium",
          sizes[size],
          bgColors[colorIndex],
          className
        )}
      >
        {image && (
          <BaseAvatar.Image
            src={image}
            alt={name}
            className="size-full object-cover"
          />
        )}
        <BaseAvatar.Fallback delay={image ? 300 : 0} className="flex size-full items-center justify-center">
          {getInitials(name)}
        </BaseAvatar.Fallback>
      </BaseAvatar.Root>
      {statusDot}
    </div>
  );
}

/* ---- Avatar Group ---- */

interface AvatarGroupProps {
  children: ReactNode;
  max?: number;
  size?: keyof typeof sizes;
  className?: string;
}

export function AvatarGroup({
  children,
  max = 4,
  size = "sm",
  className,
}: AvatarGroupProps) {
  const items = Array.isArray(children) ? children : [children];
  const visible = items.slice(0, max);
  const remaining = items.length - max;

  return (
    <div className={cn("flex -space-x-2", className)}>
      {visible.map((child, i) => (
        <div
          key={i}
          className="ring-2 ring-white rounded-full"
          style={{ zIndex: visible.length - i }}
        >
          {child}
        </div>
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-neutral-200 font-medium text-neutral-600 ring-2 ring-white",
            sizes[size]
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}
