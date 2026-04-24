import { Link } from "@tanstack/react-router";
import {
  LogOut,
  Settings,
  User,
  ChevronDown,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

interface UserMenuProps {
  user: {
    name: string;
    email: string;
    image?: string | null;
  };
  onLogout: () => void;
}

export function UserMenu({ user, onLogout }: UserMenuProps) {
  return (
    <PopoverRoot>
      <PopoverTrigger className="group flex items-center gap-2.5 rounded-xl p-1.5 pr-2 transition-all duration-200 hover:bg-stone-100/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30 border border-transparent hover:border-stone-200/60">
        <Avatar name={user.name} image={user.image} size="sm" />
        <div className="hidden md:block text-left min-w-0">
          <p className="text-sm font-semibold text-stone-800 group-hover:text-stone-900 transition-colors truncate">
            {user.name}
          </p>
          <p className="text-xs text-stone-500 truncate max-w-[140px]">
            {user.email}
          </p>
        </div>
        <ChevronDown
          size={14}
          className="text-stone-400 group-hover:text-stone-600 transition-all group-data-[popup-open]:rotate-180 shrink-0"
        />
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-60 rounded-xl border border-stone-200/80 bg-white/95 backdrop-blur-xl p-2 shadow-elevated"
      >
        {/* User info header */}
        <div className="flex items-center gap-3 px-3 py-3 mb-1">
          <Avatar name={user.name} image={user.image} size="md" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-800 truncate">{user.name}</p>
            <p className="text-xs text-stone-500 truncate">{user.email}</p>
          </div>
        </div>

        <div className="h-px bg-stone-100 mx-2" />

        {/* Menu items */}
        <nav className="py-1.5">
          <Link
            to="/settings"
            className="flex items-center gap-3 px-3 py-2 text-sm text-stone-600 rounded-lg hover:bg-stone-100/80 hover:text-stone-900 transition-all"
          >
            <Settings size={16} className="text-stone-400" />
            Settings
          </Link>
          <Link
            to="/settings"
            className="flex items-center gap-3 px-3 py-2 text-sm text-stone-600 rounded-lg hover:bg-stone-100/80 hover:text-stone-900 transition-all"
          >
            <User size={16} className="text-stone-400" />
            Profile
          </Link>
        </nav>

        <div className="h-px bg-stone-100 mx-2" />

        {/* Logout */}
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 px-3 py-2 mt-1 text-sm text-danger-600 rounded-lg hover:bg-danger-50 transition-all"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </PopoverContent>
    </PopoverRoot>
  );
}
