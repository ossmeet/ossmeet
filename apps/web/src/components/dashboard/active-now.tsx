import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Video, Users, Zap } from "lucide-react";
import { myActiveMeetingsQueryOptions } from "@/queries/meetings";
import { Button } from "@/components/ui/button";
import type { getMyActiveMeetings } from "@/server/meetings/dashboard";

type ActiveMeeting = Awaited<ReturnType<typeof getMyActiveMeetings>>["meetings"][number];

function formatTimeSince(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just started";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function ActiveNow() {
  const { data } = useSuspenseQuery(myActiveMeetingsQueryOptions());
  const meetingSessions: ActiveMeeting[] = data?.meetings ?? [];

  if (meetingSessions.length === 0) {
    return null; // Hide section when empty - less clutter
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-1 rounded-full bg-gradient-to-b from-emerald-500 to-emerald-600" />
        <h2 className="text-base font-semibold text-stone-800">Active Now</h2>
        <span className="ml-2 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full animate-pulse">
          {meetingSessions.length}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {meetingSessions.map((meeting: ActiveMeeting) => (
          <div
            key={meeting.id}
            className="group relative bento-card p-5"
          >
            {/* Live indicator */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-emerald-600">
                {formatTimeSince(new Date(meeting.startedAt))}
              </span>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50">
                <Video className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="min-w-0 flex-1 pr-16">
                <h3 className="text-sm font-semibold text-stone-800 truncate">
                  {meeting.title || meeting.code}
                </h3>
                {meeting.spaceName && (
                  <p className="text-xs text-stone-500 mt-0.5">{meeting.spaceName}</p>
                )}
                <div className="flex items-center gap-1.5 mt-2 text-xs text-stone-500">
                  <Users size={12} />
                  <span>{meeting.participantCount} participant{meeting.participantCount !== 1 ? "s" : ""}</span>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <Link to="/$code" params={{ code: meeting.code }}>
                <Button size="sm" variant="accent" className="w-full">
                  <Zap className="mr-1.5 h-3.5 w-3.5" />
                  Join Now
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
