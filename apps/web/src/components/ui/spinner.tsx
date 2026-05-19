import { cn } from "@ossmeet/shared";

const sizeClasses = {
  sm: "h-4 w-4 border-[1.5px]",
  md: "h-5 w-5 border-2",
  lg: "h-8 w-8 border-[2.5px]",
};

interface SpinnerProps {
  size?: keyof typeof sizeClasses;
  brand?: boolean;
  className?: string;
}

export function Spinner({ size = "md", brand = false, className }: SpinnerProps) {
  return (
    <div
      className={cn(
        "animate-spin rounded-full",
        sizeClasses[size],
        brand
          ? "border-accent-200 border-t-accent-600"
          : "border-neutral-300 border-t-accent-600",
        className
      )}
    />
  );
}
