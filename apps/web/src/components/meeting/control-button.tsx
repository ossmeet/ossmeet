import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@ossmeet/shared";

interface ControlButtonProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  danger?: boolean;
  accent?: boolean;
  badge?: number;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

export function ControlButton({
  icon: Icon,
  label,
  active = false,
  danger = false,
  accent = false,
  badge,
  disabled = false,
  onClick,
  className,
}: ControlButtonProps) {
  const base =
    "relative flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/50 active:scale-[0.95]";

  let colors: string;
  if (danger) {
    colors = "bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-800";
  } else if (active && accent) {
    colors =
      "bg-accent-700 text-white hover:bg-accent-800 active:bg-accent-900";
  } else if (active) {
    colors = "bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-800";
  } else {
    colors =
      "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white active:bg-neutral-600";
  }

  return (
    <Tooltip content={label} side="top">
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(base, colors, disabled && "opacity-40 cursor-not-allowed", className)}
        aria-label={label}
      >
        <Icon className="h-5 w-5" />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1 text-2xs font-bold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
