import { useEffect, useState } from "react";
import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Clock, Users, FileText, CheckSquare, Gavel, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { publicRecapQueryOptions, ensurePublicRecapQueryOptions } from "@/queries/meeting-recap";

const AUTO_TRIGGER_INITIAL_DELAY_MS = 5_000;
const AUTO_TRIGGER_MAX_ATTEMPTS = 3;

/** Exponential backoff: 2s → 5s → 10s */
function autoTriggerRetryDelay(attempt: number): number {
  return Math.min(2_000 * 2.5 ** attempt, 10_000);
}

type SummaryData = {
  id: string;
  summary: string;
  topics: string[];
  actionItems: string[];
  decisions: string[];
  durationSeconds: number | null;
  participantCount: number | null;
  createdAt: Date | null;
};

export const Route = createLazyFileRoute("/recap/$code")({
  component: PublicMeetingRecapPage,
  pendingComponent: () => (
    <div className="flex h-64 items-center justify-center">
      <Spinner size="lg" brand />
    </div>
  ),
});

function PublicMeetingRecapPage() {
  const { code } = Route.useParams();
  const { meetingId, admissionId } = Route.useSearch();
  const queryClient = useQueryClient();
  const [ensureAttempts, setEnsureAttempts] = useState(0);
  const hasAccessParams = Boolean(meetingId && admissionId);

  const recapOptions = publicRecapQueryOptions(code, meetingId ?? "", admissionId ?? "");

  const summaryQuery = useQuery({
    ...recapOptions,
    enabled: hasAccessParams,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? autoTriggerRetryDelay(ensureAttempts) : false,
  });

  const ensureMutation = useMutation({
    ...ensurePublicRecapQueryOptions(meetingId ?? "", admissionId ?? ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: recapOptions.queryKey });
    },
  });
  const { mutate: ensureSummary, isPending: isEnsuringSummary } = ensureMutation;

  useEffect(() => {
    if (!hasAccessParams) return;
    if (summaryQuery.data?.status === "ready") {
      setEnsureAttempts(0);
      return;
    }
    if (summaryQuery.data?.status === "active") return;
    if (isEnsuringSummary) return;
    if (ensureAttempts >= AUTO_TRIGGER_MAX_ATTEMPTS) return;

    const delay = ensureAttempts === 0
      ? AUTO_TRIGGER_INITIAL_DELAY_MS
      : autoTriggerRetryDelay(ensureAttempts - 1);

    const timeout = window.setTimeout(() => {
      setEnsureAttempts((attempt) => attempt + 1);
      ensureSummary();
    }, delay);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    ensureAttempts,
    ensureSummary,
    hasAccessParams,
    isEnsuringSummary,
    summaryQuery.data?.status,
  ]);

  if (!hasAccessParams) {
    return (
      <PageShell>
        <EmptyState
          icon={AlertTriangle}
          title="Recap unavailable"
          description="This recap link is missing the session access details needed to open it."
          action={
            <Link to="/">
              <Button variant="secondary" size="sm">Return home</Button>
            </Link>
          }
        />
      </PageShell>
    );
  }

  if (summaryQuery.isPending && !summaryQuery.data) {
    return (
      <PageShell>
        <Spinner size="lg" brand />
      </PageShell>
    );
  }

  if (summaryQuery.error) {
    return (
      <PageShell>
        <EmptyState
          icon={AlertTriangle}
          title="Could not load recap"
          description="We couldn't verify access to this meeting recap."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void queryClient.invalidateQueries({
                  queryKey: recapOptions.queryKey,
                });
              }}
            >
              Retry
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (summaryQuery.data?.status === "active" || summaryQuery.data?.status === "pending") {
    return (
      <PageShell>
        <div className="relative overflow-hidden rounded-[2rem] border border-stone-200/80 bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.12),_transparent_42%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(247,247,246,0.96))] px-6 py-16 shadow-[0_30px_80px_-50px_rgba(20,184,166,0.45)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-teal-100/50 to-transparent" />
          <div className="relative flex flex-col items-center justify-center text-center">
            <div className="relative mb-8 flex h-28 w-28 items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-teal-200/80 animate-spin-slow" />
              <div className="absolute inset-[14px] rounded-full border-2 border-dashed border-teal-300/70 animate-spin" />
              <div className="absolute inset-5 rounded-full bg-teal-100/80 blur-xl animate-pulse" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-[1.75rem] bg-white text-teal-700 shadow-[0_16px_36px_-22px_rgba(15,118,110,0.6)] ring-1 ring-teal-100">
                <Sparkles size={30} className="animate-pulse" />
              </div>
            </div>

            <p className="rounded-full border border-teal-200/80 bg-white/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-teal-700">
              Meeting ended
            </p>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-stone-900">
              Preparing your AI recap
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600 sm:text-base">
              The host ended the meeting. We are syncing the final transcript and preparing the recap now.
            </p>
            <div className="mt-8 flex items-center gap-2 text-sm text-stone-500">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500/70 animate-bounce-dot" />
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500/70 animate-bounce-dot [animation-delay:0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500/70 animate-bounce-dot [animation-delay:0.3s]" />
              <span className="ml-2">
                {ensureMutation.isPending ? "Finalizing summary…" : "This usually takes a few seconds."}
              </span>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  const summary = summaryQuery.data?.summary as SummaryData | null;
  if (!summary) {
    return (
      <PageShell>
        <EmptyState
          icon={AlertTriangle}
          title="Recap unavailable"
          description="We couldn't prepare the meeting recap yet."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEnsureAttempts(0);
                ensureMutation.reset();
                void queryClient.invalidateQueries({
                  queryKey: recapOptions.queryKey,
                });
              }}
            >
              <RefreshCw size={14} className="mr-1.5" />
              Retry
            </Button>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-gradient-to-br from-accent-500/20 to-accent-600/20 p-2.5">
          <Sparkles size={20} className="text-accent-700" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Meeting Recap</h1>
          <p className="text-sm text-neutral-500">AI-generated summary</p>
        </div>
      </div>

      <Card variant="glass">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary-100 p-2 shrink-0">
            <FileText size={16} className="text-accent-700" />
          </div>
          <p className="text-sm leading-relaxed text-neutral-700">{summary.summary}</p>
        </div>
      </Card>

      {summary.topics.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.topics.map((topic) => (
            <Badge key={topic} variant="primary" size="md" dot>
              {topic}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {summary.actionItems.length > 0 && (
          <Card variant="glass">
            <div className="mb-3 flex items-center gap-2">
              <CheckSquare size={16} className="text-accent-700" />
              <h2 className="text-sm font-semibold text-neutral-900">Action Items</h2>
            </div>
            <ul className="space-y-2">
              {summary.actionItems.map((item, index) => (
                <li key={`${item}-${index}`} className="flex items-start gap-2 text-sm text-neutral-700">
                  <span className="mt-1 h-4 w-4 shrink-0 rounded border border-neutral-300" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {summary.decisions.length > 0 && (
          <Card variant="glass">
            <div className="mb-3 flex items-center gap-2">
              <Gavel size={16} className="text-accent-700" />
              <h2 className="text-sm font-semibold text-neutral-900">Decisions</h2>
            </div>
            <ul className="space-y-2">
              {summary.decisions.map((decision, index) => (
                <li key={`${decision}-${index}`} className="text-sm text-neutral-700">
                  {decision}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-500">
        {summary.durationSeconds != null && (
          <span className="flex items-center gap-1.5">
            <Clock size={14} />
            {formatDuration(summary.durationSeconds)}
          </span>
        )}
        {summary.participantCount != null && (
          <span className="flex items-center gap-1.5">
            <Users size={14} />
            {summary.participantCount} {summary.participantCount === 1 ? "participant" : "participants"}
          </span>
        )}
        {summary.createdAt && (
          <span>Generated {formatTimeAgo(summary.createdAt)}</span>
        )}
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
      <div className="w-full space-y-6">{children}</div>
    </div>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m} min`;
  return "< 1 min";
}

function formatTimeAgo(date: Date | null): string {
  if (!date) return "";
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}
