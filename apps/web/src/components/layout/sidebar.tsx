import { Link } from "@tanstack/react-router";
import {
  Home,
  Globe,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@ossmeet/shared";
import { BrandMark } from "@/components/brand-mark";

const navItems = [
  { to: "/dashboard" as const, label: "Dashboard", icon: Home },
  { to: "/spaces" as const, label: "Spaces", icon: Globe },
  { to: "/settings" as const, label: "Settings", icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col shrink-0 border-r border-stone-200/60 bg-white/70 backdrop-blur-xl transition-all duration-300 ease-out",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo */}
      <div className={cn("flex items-center", collapsed ? "justify-center p-4" : "px-5 py-5")}>
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="h-8 w-8 shrink-0 rounded-xl bg-gradient-to-br from-accent-600 to-accent-700 flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
            <BrandMark className="h-4.5 w-4.5 text-white" />
          </div>
          {!collapsed && (
            <span className="text-lg font-bold text-stone-800 font-heading tracking-tight">
              OSSMeet
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-2">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-stone-500 transition-all duration-200 hover:bg-stone-100/80 hover:text-stone-700",
              collapsed && "justify-center px-2"
            )}
            activeProps={{
              className: cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium bg-accent-50/80 text-accent-700 shadow-sm transition-all duration-200",
                collapsed && "justify-center px-2"
              ),
            }}
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={18}
                  className={cn(
                    "shrink-0 transition-colors duration-200",
                    isActive ? "text-accent-600" : "text-stone-400"
                  )}
                />
                {!collapsed && <span>{label}</span>}
              </>
            )}
          </Link>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="p-2 mt-auto border-t border-stone-200/60">
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-center rounded-xl p-2 text-stone-400 transition-all duration-200 hover:bg-stone-100/80 hover:text-stone-600"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}
