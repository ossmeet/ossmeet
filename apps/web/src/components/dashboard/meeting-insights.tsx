import { useSuspenseQueries } from "@tanstack/react-query";
import { myRecentMeetingsQueryOptions } from "@/queries/meetings";
import { mySpacesQueryOptions } from "@/queries/spaces";
import { TrendingUp, TrendingDown, Clock, Calendar, Users, Sparkles } from "lucide-react";

interface WeeklyStats {
  totalHours: number;
  meetingCount: number;
  avgDuration: number;
  trend: "up" | "down" | "neutral";
  trendValue: number;
}

function calculateWeeklyStats(meetingSessions: Array<{ startedAt: string | null; endedAt: string | null }>): WeeklyStats {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const thisWeekMeetings = meetingSessions.filter(m => {
    if (!m.startedAt) return false;
    const date = new Date(m.startedAt);
    return date >= oneWeekAgo && date <= now;
  });

  const lastWeekMeetings = meetingSessions.filter(m => {
    if (!m.startedAt) return false;
    const date = new Date(m.startedAt);
    return date >= twoWeeksAgo && date < oneWeekAgo;
  });

  let totalMinutes = 0;
  thisWeekMeetings.forEach(m => {
    if (m.startedAt && m.endedAt) {
      const duration = (new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime()) / 60000;
      totalMinutes += Math.max(0, duration);
    }
  });

  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
  const avgDuration = thisWeekMeetings.length > 0
    ? Math.round(totalMinutes / thisWeekMeetings.length)
    : 0;

  const trend = thisWeekMeetings.length > lastWeekMeetings.length ? "up" : "down";
  const trendValue = lastWeekMeetings.length > 0
    ? Math.round(((thisWeekMeetings.length - lastWeekMeetings.length) / lastWeekMeetings.length) * 100)
    : 0;

  return {
    totalHours,
    meetingCount: thisWeekMeetings.length,
    avgDuration,
    trend,
    trendValue: Math.abs(trendValue),
  };
}

export function MeetingInsights() {
  const [{ data: meetingsData }, { data: spacesData }] = useSuspenseQueries({
    queries: [myRecentMeetingsQueryOptions(), mySpacesQueryOptions()],
  });

  const meetingSessions = meetingsData?.meetings ?? [];
  const spaces = spacesData?.spaces ?? [];
  const stats = calculateWeeklyStats(meetingSessions);

  const hasActivity = meetingSessions.length > 0;

  return (
    <section className="relative">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-1 rounded-full bg-gradient-to-b from-violet-500 to-violet-600" />
        <h2 className="text-base font-semibold text-stone-800">Weekly Insights</h2>
        <span className="ml-2 text-xs font-medium text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
          Last 7 days
        </span>
      </div>

      <div className="relative rounded-2xl border border-stone-200/80 bg-white/80 backdrop-blur-sm p-5 shadow-soft overflow-hidden">
        {/* Background gradient accent */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500/20 via-violet-400/30 to-violet-500/20" />

        {!hasActivity ? (
          <div className="text-center py-4">
            <div className="flex items-center justify-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-50 to-violet-100/50">
                <Sparkles className="h-5 w-5 text-violet-600" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-stone-600">No meeting data yet</p>
                <p className="text-xs text-stone-500">Start hosting meetings to see your weekly stats</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {/* Total Hours */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Clock className="h-3.5 w-3.5 text-violet-500" />
                <span className="text-xs font-medium text-stone-500">Hours</span>
              </div>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-2xl font-bold text-stone-800">{stats.totalHours}</span>
                <span className="text-xs text-stone-400">h</span>
              </div>
              <div className="flex items-center justify-center gap-1 mt-1">
                {stats.trend === "up" ? (
                  <>
                    <TrendingUp className="h-3 w-3 text-emerald-500" />
                    <span className="text-xs font-medium text-emerald-600">+{stats.trendValue}%</span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="h-3 w-3 text-stone-400" />
                    <span className="text-xs font-medium text-stone-400">{stats.trendValue}%</span>
                  </>
                )}
              </div>
            </div>

            {/* Meeting Count */}
            <div className="text-center border-l border-r border-stone-100">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Calendar className="h-3.5 w-3.5 text-violet-500" />
                <span className="text-xs font-medium text-stone-500">Meetings</span>
              </div>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-2xl font-bold text-stone-800">{stats.meetingCount}</span>
              </div>
              <div className="text-xs text-stone-400 mt-1">
                this week
              </div>
            </div>

            {/* Avg Duration */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Users className="h-3.5 w-3.5 text-violet-500" />
                <span className="text-xs font-medium text-stone-500">Spaces</span>
              </div>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-2xl font-bold text-stone-800">{spaces.length}</span>
              </div>
              <div className="text-xs text-stone-400 mt-1">
                active
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
