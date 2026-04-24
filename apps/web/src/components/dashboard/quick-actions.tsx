import { Link } from "@tanstack/react-router";
import {
  Keyboard,
  UserPlus,
  Settings,
} from "lucide-react";
import type { ComponentType } from "react";

interface QuickAction {
  icon: ComponentType<any>;
  title: string;
  description: string;
  href: string;
  gradient: string;
}

const actions: QuickAction[] = [
  {
    icon: Keyboard,
    title: "Join with Code",
    description: "Enter a code to join",
    href: "/dashboard",
    gradient: "from-amber-500 to-amber-600",
  },
  {
    icon: UserPlus,
    title: "Invite Members",
    description: "Add people to spaces",
    href: "/spaces",
    gradient: "from-rose-400 to-rose-500",
  },
  {
    icon: Settings,
    title: "Settings",
    description: "Manage preferences",
    href: "/settings",
    gradient: "from-slate-500 to-slate-600",
  },
];

export function QuickActions() {
  return (
    <section className="relative">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-1 rounded-full bg-gradient-to-b from-stone-400 to-stone-500" />
        <h2 className="text-base font-semibold text-stone-800">More Actions</h2>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {actions.map((action, i) => (
          <Link
            key={action.title}
            to={action.href}
            className="group relative flex flex-col items-center text-center gap-2 rounded-xl border border-stone-200/80 bg-white/80 backdrop-blur-sm p-4 transition-all duration-200 hover:border-stone-300/80 hover:bg-white shadow-soft hover:shadow-card animate-fade-in-up overflow-hidden"
            style={{
              animationDelay: `${i * 75}ms`,
            }}
          >
            {/* Subtle gradient background on hover */}
            <div className={`absolute inset-0 bg-gradient-to-br ${action.gradient} opacity-0 transition-opacity duration-200 group-hover:opacity-[0.03]`} />

            <div
              className={`relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${action.gradient} shadow-sm transition-all duration-200 group-hover:scale-105`}
            >
              <action.icon className="h-5 w-5 text-white" />
            </div>
            <div className="relative">
              <p className="text-xs font-medium text-stone-700 group-hover:text-accent-700 transition-colors">
                {action.title}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
