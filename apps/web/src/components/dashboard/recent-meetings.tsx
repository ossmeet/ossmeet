import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Sparkles, Clock, Users, Download, Loader2, ChevronRight } from "lucide-react";
import { myRecentMeetingsQueryOptions } from "@/queries/meetings";
import { queryKeys } from "@/lib/query-keys";
import { generateMeetingNotes } from "@/server/transcripts/generate-notes";
import { getWhiteboardPdfDownloadUrl } from "@/server/meetings/whiteboard-export";
import type { getMyRecentMeetings } from "@/server/meetings/crud";

function formatRelativeTime(date: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  const m = Math.floor(s / 60);
  if (m < 1) return "< 1m";
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

type Meeting = Awaited<ReturnType<typeof getMyRecentMeetings>>["meetings"][number];

function SummaryCell({ meeting }: { meeting: Meeting }) {
  const queryClient = useQueryClient();
  const [localHasSummary, setLocalHasSummary] = useState(meeting.hasSummary);

  const generateMutation = useMutation({
    mutationFn: () => generateMeetingNotes({ data: { meetingId: meeting.sessionId ?? meeting.id } }),
    onSuccess: (result) => {
      if (result.summary) {
        setLocalHasSummary(true);
        queryClient.invalidateQueries({ queryKey: queryKeys.meetings.recent() });
      }
    },
  });

  if (localHasSummary) {
    return (
      <Link
        to="/dashboard/$code"
        params={{ code: meeting.code }}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors"
      >
        <Sparkles size={12} />
        View
      </Link>
    );
  }

  return (
    <button
      onClick={() => generateMutation.mutate()}
      disabled={generateMutation.isPending}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-violet-600 transition-colors disabled:opacity-50"
    >
      {generateMutation.isPending
        ? <><Loader2 size={12} className="animate-spin" /> Generating…</>
        : <><Sparkles size={12} /> Generate</>
      }
    </button>
  );
}

function PdfCell({ meeting }: { meeting: Meeting }) {
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);

  if (!meeting.hasWhiteboardState) {
    return <span className="text-xs text-stone-300">—</span>;
  }

  if (meeting.hasWhiteboardPdf) {
    const handleDownload = async () => {
      setDownloading(true);
      try {
        const { downloadUrl } = await getWhiteboardPdfDownloadUrl({ data: { sessionId: meeting.sessionId ?? meeting.id } });
        window.open(downloadUrl, "_blank");
      } finally {
        setDownloading(false);
      }
    };

    return (
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-600 hover:text-teal-700 transition-colors disabled:opacity-50"
      >
        {downloading
          ? <><Loader2 size={12} className="animate-spin" /> Opening…</>
          : <><Download size={12} /> Download</>
        }
      </button>
    );
  }

  return (
    <button
      onClick={() => navigate({ to: "/dashboard/$code", params: { code: meeting.code } })}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-teal-600 transition-colors"
    >
      <FileText size={12} /> Generate PDF
    </button>
  );
}

export function RecentMeetings() {
  const { data } = useSuspenseQuery(myRecentMeetingsQueryOptions());
  const meetingSessions: Meeting[] = data?.meetings ?? [];

  if (meetingSessions.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-3">
          Recent Meetings
        </h2>
        <div className="bento-card p-8 text-center">
          <p className="text-sm text-stone-500">No meetings yet</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-3">
        Recent Meetings
      </h2>
      <div className="bento-card overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-teal-500/40 via-teal-400/50 to-teal-500/40" />
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-stone-400 uppercase tracking-wide">Meeting</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-stone-400 uppercase tracking-wide w-32">AI Summary</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-stone-400 uppercase tracking-wide w-36">Whiteboard PDF</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-stone-400 uppercase tracking-wide w-24">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {meetingSessions.map((meeting: Meeting) => (
              <tr key={meeting.id} className="group hover:bg-stone-50/60 transition-colors">
                <td className="px-4 py-3">
                  <Link
                    to="/dashboard/$code"
                    params={{ code: meeting.code }}
                    className="block"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-stone-800 group-hover:text-accent-700 transition-colors truncate max-w-[200px]">
                        {meeting.title || meeting.code}
                      </span>
                      <ChevronRight size={12} className="text-stone-300 group-hover:text-accent-500 shrink-0 transition-colors" />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-stone-400">
                      {meeting.startedAt && meeting.endedAt && (
                        <span className="flex items-center gap-1">
                          <Clock size={10} />
                          {formatDuration(meeting.startedAt, meeting.endedAt)}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Users size={10} />
                        {meeting.participantCount}
                      </span>
                      {meeting.spaceName && (
                        <span className="text-stone-300">· {meeting.spaceName}</span>
                      )}
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <SummaryCell meeting={meeting} />
                </td>
                <td className="px-4 py-3">
                  <PdfCell meeting={meeting} />
                </td>
                <td className="px-4 py-3 text-xs text-stone-400 whitespace-nowrap">
                  {formatRelativeTime(meeting.startedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
