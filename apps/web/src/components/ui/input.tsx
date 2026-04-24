import { Field } from "@base-ui/react/field";
import { cn } from "@ossmeet/shared";
import type { InputHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, leftIcon, rightIcon, name, id, ...props }, ref) => {
    return (
      <Field.Root invalid={!!error} name={name} className="w-full">
        {label && (
          <Field.Label className="mb-1.5 block text-sm font-medium text-neutral-700">
            {label}
          </Field.Label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
              {leftIcon}
            </div>
          )}
          <Field.Control
            ref={ref}
            id={id}
            className={cn(
              "flex h-10 w-full rounded-lg border bg-white px-3 py-2 text-sm transition-all duration-150 placeholder:text-neutral-400 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
              error
                ? "border-danger-300 focus-visible:border-danger-500 focus-visible:ring-2 focus-visible:ring-danger-500/20"
                : "border-neutral-300 focus-visible:border-accent-400 focus-visible:ring-2 focus-visible:ring-accent-500/20",
              leftIcon && "pl-10",
              rightIcon && "pr-10",
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400">
              {rightIcon}
            </div>
          )}
        </div>
        {error && (
          <Field.Error match className="mt-1.5 text-sm text-danger-600">
            {error}
          </Field.Error>
        )}
      </Field.Root>
    );
  }
);

Input.displayName = "Input";
