import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@ossmeet/shared";
import type { HTMLAttributes, ReactNode } from "react";

const cardVariants = cva("rounded-xl p-5", {
  variants: {
    variant: {
      default: "bg-white border border-neutral-200/60 shadow-soft",
      elevated: "bg-white border border-neutral-200/80 shadow-card",
      outlined: "bg-transparent border border-neutral-200",
      glass:
        "bg-white/90 backdrop-blur-sm border border-neutral-200/60 shadow-soft",
      interactive:
        "bg-white border border-neutral-200/60 shadow-soft transition-all duration-200 hover:shadow-card hover:border-neutral-300 cursor-pointer",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  children: ReactNode;
}

export function Card({
  variant,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(cardVariants({ variant }), className)}
      {...props}
    >
      {children}
    </div>
  );
}
