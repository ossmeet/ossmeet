import { cn } from "@ossmeet/shared";
import type { ReactNode, ComponentType } from "react";

interface EmptyStateProps {
  icon?: ComponentType<{ size?: number; className?: string }>;
  illustration?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 text-center animate-fade-in-up",
        className
      )}
    >
      {illustration ? (
        <div className="mb-6">{illustration}</div>
      ) : Icon ? (
        <div className="mb-4 rounded-2xl bg-neutral-100 p-4">
          <Icon size={32} className="text-neutral-400" />
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-neutral-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
