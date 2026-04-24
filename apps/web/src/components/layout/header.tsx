import { Avatar } from "@/components/ui/avatar";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import type { ReactNode } from "react";

interface HeaderProps {
  breadcrumbs?: { label: string; href?: string; onClick?: () => void }[];
  user: { name: string; image?: string | null };
  children?: ReactNode;
}

export function Header({ breadcrumbs, user, children }: HeaderProps) {
  return (
    <div className="sticky top-0 z-30 hidden border-b border-neutral-100 bg-white/80 backdrop-blur-lg px-6 py-3 lg:flex items-center justify-between">
      <div className="flex items-center gap-4">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <Breadcrumb items={breadcrumbs} />
        )}
        {children}
      </div>
      <div className="flex items-center gap-3">
        <Avatar name={user.name} image={user.image} size="sm" />
      </div>
    </div>
  );
}
