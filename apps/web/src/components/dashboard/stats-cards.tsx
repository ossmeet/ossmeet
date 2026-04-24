import { useSuspenseQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Globe,
  Users,
  TrendingUp,
} from "lucide-react";
import { mySpacesQueryOptions } from "@/queries/spaces";
import { myRecentMeetingsQueryOptions } from "@/queries/meetings";
import type { ComponentType } from "react";

interface StatConfig {
  label: string;
  value: string;
  icon: ComponentType<any>;
  gradient: string;
  trend?: string;
}

interface StatsCardsProps {
  compact?: boolean;
}

export function StatsCards({ compact = false }: StatsCardsProps) {
  const { data: activeSpacesCount } = useSuspenseQuery({
    ...mySpacesQueryOptions(),
    select: (data) => data?.spaces?.length ?? 0,
  });

  const { data: meetingCount } = useSuspenseQuery({
    ...myRecentMeetingsQueryOptions(),
    select: (data) => data?.meetings?.length ?? 0,
  });

  const stats: StatConfig[] = [
    {
      label: "Total Meetings",
      value: String(meetingCount),
      icon: BarChart3,
      gradient: "from-accent-600 to-accent-700",
    },
    {
      label: "Active Spaces",
      value: String(activeSpacesCount),
      icon: Globe,
      gradient: "from-amber-500 to-amber-600",
    },
    {
      label: "Team Members",
      value: "\u2014",
      icon: Users,
      gradient: "from-violet-500 to-violet-600",
    },
  ];

  // Compact stacked layout for sidebar area
  if (compact) {
    return (
      <div className="flex flex-col gap-3 h-full">
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className="group relative overflow-hidden rounded-xl border border-stone-200/80 bg-white/80 backdrop-blur-sm p-4 shadow-soft transition-all duration-200 hover:shadow-card hover:border-stone-300/80 hover:bg-white flex-1 animate-fade-in-up"
            style={{
              animationDelay: `${i * 75}ms`,
            }}
          >
            {/* Subtle gradient overlay */}
            <div className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-[0.03] transition-opacity group-hover:opacity-[0.05]`} />

            <div className="relative flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wider">{stat.label}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xl font-bold text-stone-800">
                    {stat.value}
                  </p>
                  {stat.trend && (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600">
                      <TrendingUp size={12} />
                      {stat.trend}
                    </span>
                  )}
                </div>
              </div>
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${stat.gradient} shadow-sm transition-transform duration-200 group-hover:scale-105`}
              >
                <stat.icon className="h-4 w-4 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Full width horizontal layout
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className="group relative overflow-hidden rounded-xl border border-stone-200 bg-white p-5 shadow-soft transition-all duration-200 hover:shadow-card hover:border-stone-300 animate-fade-in-up"
          style={{
            animationDelay: `${i * 75}ms`,
          }}
        >
          {/* Subtle gradient overlay */}
          <div className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-[0.03] transition-opacity group-hover:opacity-[0.06]`} />

          <div className="relative flex items-center gap-4">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${stat.gradient} shadow-sm transition-transform duration-200 group-hover:scale-105`}
            >
              <stat.icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-stone-500">{stat.label}</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-stone-800">
                  {stat.value}
                </p>
                {stat.trend && (
                  <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600">
                    <TrendingUp size={12} />
                    {stat.trend}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
