import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@ossmeet/shared";
import { Spinner } from "./spinner";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-accent-700 text-white shadow-soft hover:bg-accent-800 hover:shadow-card active:bg-accent-900",
        secondary:
          "border border-neutral-200 bg-white text-neutral-800 shadow-soft hover:bg-neutral-50 hover:border-neutral-300 hover:shadow-card",
        ghost:
          "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
        danger:
          "bg-danger-600 text-white shadow-soft hover:bg-danger-700 active:bg-danger-800",
        accent:
          "bg-stone-900 text-white shadow-soft hover:bg-stone-800 hover:shadow-card active:bg-stone-950",
        outline:
          "border border-accent-300 bg-transparent text-accent-700 hover:bg-accent-50 hover:border-accent-400",
        link: "text-accent-700 underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-xs gap-1.5",
        md: "h-10 px-4 gap-2",
        lg: "h-12 px-6 text-base gap-2",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  className,
  variant,
  size,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <Spinner className="h-4 w-4" />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export { buttonVariants };
