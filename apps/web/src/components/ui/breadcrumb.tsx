import { cn } from "@ossmeet/shared";
import { ChevronRight } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center gap-1 text-sm", className)}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight size={12} className="text-neutral-400" />
            )}
            {isLast || (!item.href && !item.onClick) ? (
              <span
                className={cn(
                  isLast
                    ? "font-medium text-neutral-900"
                    : "text-neutral-500"
                )}
              >
                {item.label}
              </span>
            ) : (
              <button
                onClick={item.onClick}
                className="text-neutral-500 transition-colors hover:text-neutral-700"
              >
                {item.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
