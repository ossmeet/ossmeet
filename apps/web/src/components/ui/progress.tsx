import { Progress as BaseProgress } from "@base-ui/react/progress";
import { cn } from "@ossmeet/shared";

const variantColors = {
  default: "bg-accent-500",
  success: "bg-success-500",
  warning: "bg-amber-500",
  danger: "bg-danger-500",
  accent: "bg-accent-500",
};

interface ProgressProps {
  value: number;
  max?: number;
  variant?: keyof typeof variantColors;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Progress({
  value,
  max = 100,
  variant = "default",
  size = "md",
  className,
}: ProgressProps) {
  const sizeClasses = {
    sm: "h-1",
    md: "h-2",
    lg: "h-3",
  };

  return (
    <BaseProgress.Root
      value={value}
      max={max}
      className={cn(
        "w-full overflow-hidden rounded-full bg-neutral-200",
        sizeClasses[size],
        className
      )}
    >
      <BaseProgress.Track className="h-full w-full">
        <BaseProgress.Indicator
          className={cn(
            "h-full rounded-full transition-all duration-300 ease-out",
            variantColors[variant]
          )}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
