import { Link } from "@tanstack/react-router";
import {
  Home,
  Globe,
  Settings,
} from "lucide-react";

const navItems = [
  { to: "/dashboard" as const, label: "Dashboard", icon: Home },
  { to: "/spaces" as const, label: "Spaces", icon: Globe },
  { to: "/settings" as const, label: "Settings", icon: Settings },
];

export function MobileNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-neutral-200 bg-white/95 backdrop-blur-sm lg:hidden safe-area-bottom">
      <div className="flex items-center justify-around px-2 py-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex flex-col items-center gap-0.5 px-3 py-2 text-neutral-400 transition-colors min-w-[44px] min-h-[44px] justify-center"
            activeProps={{
              className:
                "flex flex-col items-center gap-0.5 px-3 py-2 text-accent-600 transition-colors min-w-[44px] min-h-[44px] justify-center",
            }}
          >
            {({ isActive: _isActive }) => (
              <>
                <Icon
                  size={22}
                />
                <span className="text-2xs font-medium">{label}</span>
              </>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}
