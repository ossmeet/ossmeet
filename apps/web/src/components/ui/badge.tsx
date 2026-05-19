import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@ossmeet/shared";
import { X } from "lucide-react";
import type { ReactNode } from "react";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full font-medium",
  {
    variants: {
      variant: {
        default: "",
        primary: "",
        success: "",
        warning: "",
        danger: "",
        accent: "",
      },
      size: {
        sm: "px-1.5 py-0.5 text-2xs",
        md: "px-2 py-0.5 text-xs",
      },
      outline: {
        true: "border",
        false: "",
      },
    },
    compoundVariants: [
      // Solid variants
      { variant: "default", outline: false, className: "bg-neutral-100 text-neutral-700" },
      { variant: "primary", outline: false, className: "bg-accent-100 text-accent-700" },
      { variant: "success", outline: false, className: "bg-success-100 text-success-700" },
      { variant: "warning", outline: false, className: "bg-amber-100 text-amber-700" },
      { variant: "danger", outline: false, className: "bg-danger-100 text-danger-700" },
      { variant: "accent", outline: false, className: "bg-accent-100 text-accent-700" },
      // Outline variants
      { variant: "default", outline: true, className: "border-neutral-300 text-neutral-600" },
      { variant: "primary", outline: true, className: "border-accent-300 text-accent-600" },
      { variant: "success", outline: true, className: "border-success-300 text-success-600" },
      { variant: "warning", outline: true, className: "border-amber-300 text-amber-600" },
      { variant: "danger", outline: true, className: "border-danger-300 text-danger-600" },
      { variant: "accent", outline: true, className: "border-accent-300 text-accent-600" },
    ],
    defaultVariants: {
      variant: "default",
      size: "md",
      outline: false,
    },
  }
);

const dotColors = {
  default: "bg-neutral-400",
  primary: "bg-accent-500",
  success: "bg-success-500",
  warning: "bg-amber-500",
  danger: "bg-danger-500",
  accent: "bg-accent-500",
};

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: ReactNode;
  dot?: boolean;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
}

export function Badge({
  children,
  variant = "default",
  size,
  outline,
  dot = false,
  removable = false,
  onRemove,
  className,
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size, outline }), className)}>
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", dotColors[variant!])}
        />
      )}
      {children}
      {removable && (
        <button
          onClick={onRemove}
          className="ml-0.5 -mr-0.5 rounded-full p-0.5 transition-colors hover:bg-black/10"
          aria-label="Remove"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}
