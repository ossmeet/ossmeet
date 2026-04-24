import { Link } from "@tanstack/react-router";
import { Video, CalendarPlus, Clock, ArrowRight } from "lucide-react";

interface QuickStartCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  variant: "primary" | "secondary" | "accent";
}

function QuickStartCard({ icon, title, description, href, variant }: QuickStartCardProps) {
  const variants = {
    primary: "from-accent-500 to-accent-600 border-accent-200/50",
    secondary: "from-blue-500 to-blue-600 border-blue-200/50",
    accent: "from-violet-500 to-violet-600 border-violet-200/50",
  };

  return (
    <Link
      to={href}
      className={`group relative flex items-center gap-4 p-4 rounded-xl border bg-white/80 backdrop-blur-sm shadow-soft transition-all duration-200 hover:shadow-card hover:bg-white ${variants[variant]}`}
    >
      {/* Gradient line at top */}
      <div className={`absolute top-0 left-4 right-4 h-0.5 bg-gradient-to-r ${variants[variant].split(" ")[0]} ${variants[variant].split(" ")[1]} rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${variants[variant].split(" ")[0]} ${variants[variant].split(" ")[1]} shadow-sm transition-transform duration-200 group-hover:scale-105`}>
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-stone-800 group-hover:text-accent-700 transition-colors">
          {title}
        </h3>
        <p className="text-xs text-stone-500 mt-0.5">
          {description}
        </p>
      </div>

      <ArrowRight className="h-4 w-4 text-stone-400 transition-transform group-hover:translate-x-1 group-hover:text-accent-600" />
    </Link>
  );
}

export function ScheduledMeetings() {
  return (
    <section className="relative">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-1 rounded-full bg-gradient-to-b from-blue-500 to-blue-600" />
          <h2 className="text-base font-semibold text-stone-800">Quick Start</h2>
        </div>
      </div>

      <div className="relative rounded-2xl border border-stone-200/80 bg-gradient-to-br from-white/90 to-stone-50/80 backdrop-blur-sm p-4 shadow-soft overflow-hidden">
        {/* Background gradient accent */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500/20 via-blue-400/30 to-blue-500/20" />

        <div className="space-y-3">
          <QuickStartCard
            icon={<Video className="h-5 w-5 text-white" />}
            title="Start Instant Meeting"
            description="Jump into a new meeting right now"
            href="/dashboard"
            variant="primary"
          />
          <QuickStartCard
            icon={<Clock className="h-5 w-5 text-white" />}
            title="Join with Code"
            description="Enter a meeting code to join"
            href="/dashboard"
            variant="secondary"
          />
          <QuickStartCard
            icon={<CalendarPlus className="h-5 w-5 text-white" />}
            title="Create a Space"
            description="Set up a team space for collaboration"
            href="/spaces"
            variant="accent"
          />
        </div>
      </div>
    </section>
  );
}
