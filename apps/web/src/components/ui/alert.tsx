import { cn } from "@ossmeet/shared";
import {
  Info,
  CheckCircle,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

const variants = {
  info: {
    container: "bg-accent-50 border-accent-200 text-accent-800",
    icon: Info,
    iconColor: "text-accent-500",
  },
  success: {
    container: "bg-success-50 border-success-200 text-success-800",
    icon: CheckCircle,
    iconColor: "text-success-500",
  },
  warning: {
    container: "bg-amber-50 border-amber-200 text-amber-800",
    icon: AlertTriangle,
    iconColor: "text-amber-500",
  },
  error: {
    container: "bg-danger-50 border-danger-200 text-danger-800",
    icon: XCircle,
    iconColor: "text-danger-500",
  },
};

interface AlertProps {
  variant?: keyof typeof variants;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Alert({
  variant = "info",
  title,
  children,
  className,
}: AlertProps) {
  const { container, icon: Icon, iconColor } = variants[variant];

  return (
    <div
      role="alert"
      className={cn(
        "flex gap-3 rounded-lg border p-4",
        container,
        className
      )}
    >
      <Icon size={20} className={cn("mt-0.5 shrink-0", iconColor)} />
      <div className="min-w-0 flex-1">
        {title && (
          <p className="text-sm font-semibold">{title}</p>
        )}
        <div className={cn("text-sm", title && "mt-1")}>{children}</div>
      </div>
    </div>
  );
}
