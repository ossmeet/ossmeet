import { useState } from "react";
import type { DayUptime } from "@/server/uptimerobot";

function barColor(day: DayUptime): string {
  if (day.uptimePct < 0) return "bg-neutral-200";
  if (!day.hasIncident) return "bg-success-400";
  if (day.uptimePct > 0) return "bg-warning-400";
  return "bg-danger-500";
}

function formatTooltipText(day: DayUptime): string {
  const date = formatDate(day.date);
  if (day.uptimePct < 0) return `${date}: No data`;
  if (day.hasIncident) return `${date}: ${day.uptimePct.toFixed(2)}% uptime`;
  return `${date}: 100% uptime`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function UptimeBar({
  days,
  overallPct,
  overallPctDisplay,
}: {
  days: DayUptime[];
  overallPct: number;
  overallPctDisplay: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const pctColor =
    overallPct >= 99.5
      ? "text-success-600"
      : overallPct >= 90
        ? "text-warning-600"
        : "text-danger-600";

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-neutral-400">90-day uptime</span>
        <span className={`tabular-nums text-xs font-semibold ${pctColor}`}>
          {overallPctDisplay}%
        </span>
      </div>
      <div
        className="flex gap-[2px]"
        role="group"
        aria-label="90-day uptime history"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {days.map((day, i) => {
          const isActive = hoveredIndex === i;
          return (
            <div
              key={day.date}
              className="relative flex-1"
              onMouseEnter={() => setHoveredIndex(i)}
            >
              <div
                tabIndex={0}
                role="img"
                aria-label={formatTooltipText(day)}
                onFocus={() => setHoveredIndex(i)}
                onBlur={() => setHoveredIndex(null)}
                className={`h-8 w-full rounded-[2px] transition-opacity duration-150 outline-none ${barColor(day)} ${
                  isActive
                    ? "scale-y-110 opacity-100 ring-2 ring-accent-500/40 ring-offset-1"
                    : "opacity-80"
                }`}
              />
              <div
                role="tooltip"
                className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-xl liquid-glass-dark px-3 py-2 text-white shadow-elevated transition-opacity duration-150 ${
                  isActive ? "opacity-100" : "opacity-0"
                }`}
              >
                <p className="text-xs font-medium text-neutral-300">{formatDate(day.date)}</p>
                {day.uptimePct < 0 ? (
                  <p className="mt-0.5 text-xs text-neutral-400">No data</p>
                ) : day.hasIncident ? (
                  <p className="mt-0.5 text-xs font-semibold text-warning-400">
                    {day.uptimePct.toFixed(2)}% uptime
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs font-semibold text-success-400">100% uptime</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between">
        <span className="text-[10px] text-neutral-400">90 days ago</span>
        <span className="text-[10px] text-neutral-400">Today</span>
      </div>
    </div>
  );
}
