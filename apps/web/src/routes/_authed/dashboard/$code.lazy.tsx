import { useState } from "react";
import { createLazyFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  useQuery,
  useQueryErrorResetBoundary,
} from "@tanstack/react-query";
import { meetingTranscriptsQueryOptions } from "@/queries/meeting-recap";
import { MeetingRecapPdfPanel } from "@whiteboard/dashboard";
import { useAuthedMeetingRecap } from "@/lib/meeting-recap/use-authed-meeting-recap";
import type { GenerationError } from "@/lib/meeting-recap/generation-policy";
import { formatDuration, formatTimeAgo } from "@/lib/meeting-recap/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ArrowLeft,
  FileText,
  CheckSquare,
  Gavel,
  Clock,
  Users,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  MicOff,
} from "lucide-react";
import type { getMeetingTranscripts } from "@/server/transcripts/get";

type TranscriptLine = Awaited<ReturnType<typeof getMeetingTranscripts>>["transcripts"][number];

export const Route = createLazyFileRoute("/_authed/dashboard/$code")({
  component: RoomDashboardPage,
  pendingComponent: () => (
    <div className="flex h-64 items-center justify-center">
      <Spinner size="lg" brand />
    </div>
  ),
  errorComponent: RoomDashboardError,
});

function RoomDashboardError({ error }: { error: Error }) {
  const router = useRouter();
  const resetBoundary = useQueryErrorResetBoundary();

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <EmptyState
        icon={AlertTriangle}
        title="Could not load meeting recap"
        description={error.message || "Something went wrong"}
        action={
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                resetBoundary.reset();
                router.invalidate();
              }}
            >
              Retry
            </Button>
            <Link to="/dashboard">
              <Button variant="ghost" size="sm">
                Back to Dashboard
              </Button>
            </Link>
          </div>
        }
      />
    </div>
  );
}

function RoomDashboardPage() {
  const { code } = Route.useParams();
  const {
    summaryData,
    summaryError,
    existingSummary,
    generationError,
    isGenerating,
    isPreparingSummary,
    retryGeneration,
    retrySummaryLoad,
  } = useAuthedMeetingRecap({ code, refreshRecentOnSuccess: true });

  if (summaryError) {
    return (
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-accent-700 transition-colors">
          <ArrowLeft size={14} />
          Back to Dashboard
        </Link>
        <EmptyState
          icon={AlertTriangle}
          title="Could not load meeting recap"
          description="We couldn't load the recap for this room. Please try again."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void retrySummaryLoad();
              }}
            >
              <RefreshCw size={14} className="mr-1.5" />
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (!summaryData?.session) {
    return (
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-accent-700 transition-colors">
          <ArrowLeft size={14} />
          Back to Dashboard
        </Link>
        <EmptyState
          icon={Clock}
          title="No ended sessions yet"
          description="This room has no recap history yet."
        />
      </div>
    );
  }

  if (isPreparingSummary) {
    return (
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-accent-700 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Dashboard
        </Link>
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
              We are syncing the final transcript, analyzing the discussion, and writing the recap for this meeting.
            </p>

            <div className="mt-10 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
              {[
                "Syncing last transcript segments",
                "Understanding decisions and action items",
                "Publishing the recap to this meeting page",
              ].map((step, index) => (
                <div
                  key={step}
                  className="rounded-2xl border border-stone-200/80 bg-white/85 p-4 text-left shadow-[0_18px_40px_-32px_rgba(28,25,23,0.5)]"
                  style={{ animationDelay: `${index * 120}ms` }}
                >
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-400">
                    <span className="h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
                    Step {index + 1}
                  </div>
                  <p className="mt-3 text-sm font-medium leading-6 text-stone-700">{step}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 flex items-center gap-2 text-sm text-stone-500">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500/70 animate-bounce-dot" />
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500/70 animate-bounce-dot [animation-delay:0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500/70 animate-bounce-dot [animation-delay:0.3s]" />
              <span className="ml-2">
                {isGenerating
                  ? "AI is writing the summary now."
                  : "This usually takes a few seconds."}
              </span>
            </div>

            <div className="mt-8">
              <Link to="/dashboard">
                <Button variant="secondary" size="sm">
                  Back to Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (generationError) {
    return (
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-accent-700 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Dashboard
        </Link>
        <ErrorContent
          error={generationError}
          onRetry={retryGeneration}
        />
      </div>
    );
  }

  if (!existingSummary) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-accent-700 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Dashboard
      </Link>

      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-gradient-to-br from-accent-500/20 to-accent-600/20 p-2.5">
          <Sparkles size={20} className="text-accent-700" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">
            Meeting Recap
          </h1>
          <p className="text-sm text-neutral-500">AI-generated summary</p>
        </div>
      </div>

      <Card variant="glass">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary-100 p-2 shrink-0">
            <FileText size={16} className="text-accent-700" />
          </div>
          <p className="text-sm leading-relaxed text-neutral-700">
            {existingSummary.summary}
          </p>
        </div>
      </Card>

      {MeetingRecapPdfPanel ? (
        <MeetingRecapPdfPanel session={summaryData.session} code={code} />
      ) : null}

      {existingSummary.topics.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {existingSummary.topics.map((topic) => (
            <Badge key={topic} variant="primary" size="md" dot>
              {topic}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {existingSummary.actionItems.length > 0 && (
          <Card variant="glass">
            <div className="flex items-center gap-2 mb-3">
              <CheckSquare size={16} className="text-accent-700" />
              <h2 className="text-sm font-semibold text-neutral-900">
                Action Items
              </h2>
              <span className="ml-auto text-xs text-neutral-400">
                {existingSummary.actionItems.length}
              </span>
            </div>
            <ul className="space-y-2">
              {existingSummary.actionItems.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
                  <span className="mt-1 h-4 w-4 shrink-0 rounded border border-neutral-300" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {existingSummary.decisions.length > 0 && (
          <Card variant="glass">
            <div className="flex items-center gap-2 mb-3">
              <Gavel size={16} className="text-accent-700" />
              <h2 className="text-sm font-semibold text-neutral-900">
                Decisions
              </h2>
              <span className="ml-auto text-xs text-neutral-400">
                {existingSummary.decisions.length}
              </span>
            </div>
            <ul className="space-y-2">
              {existingSummary.decisions.map((decision, i) => (
                <li key={i} className="text-sm text-neutral-700">
                  {decision}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-500">
        {existingSummary.durationSeconds != null && (
          <span className="flex items-center gap-1.5">
            <Clock size={14} />
            {formatDuration(existingSummary.durationSeconds)}
          </span>
        )}
        {existingSummary.participantCount != null && (
          <span className="flex items-center gap-1.5">
            <Users size={14} />
            {existingSummary.participantCount}{" "}
            {existingSummary.participantCount === 1 ? "participant" : "participants"}
          </span>
        )}
        {existingSummary.createdAt && (
          <span>
            Generated {formatTimeAgo(existingSummary.createdAt)}
          </span>
        )}
      </div>

      <TranscriptSection code={code} />
    </div>
  );
}

function ErrorContent({
  error,
  onRetry,
}: {
  error: GenerationError;
  onRetry: () => void;
}) {
  if (error === "no_transcript") {
    return (
      <EmptyState
        icon={MicOff}
        title="No transcript available"
        description="No speech was recorded during this meeting. Make sure your microphone is on to generate a summary."
        action={
          <Link to="/dashboard">
            <Button variant="secondary" size="sm">
              Back to Dashboard
            </Button>
          </Link>
        }
      />
    );
  }

  if (error === "ai_not_configured") {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="AI summary unavailable"
        description="AI features are not configured for this workspace. Contact your administrator."
        action={
          <Link to="/dashboard">
            <Button variant="secondary" size="sm">
              Back to Dashboard
            </Button>
          </Link>
        }
      />
    );
  }

  if (error === "meeting_not_ended") {
    return (
      <EmptyState
        icon={Clock}
        title="Meeting still active"
        description="Summary can be generated after the meeting ends and transcripts are archived."
        action={
          <Link to="/dashboard">
            <Button variant="secondary" size="sm">
              Back to Dashboard
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={AlertTriangle}
      title="Could not generate summary"
      description="Something went wrong while analyzing the transcript. Please try again."
      action={
        <div className="flex gap-3">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw size={14} className="mr-1.5" />
            Try again
          </Button>
          <Link to="/dashboard">
            <Button variant="ghost" size="sm">
              Back to Dashboard
            </Button>
          </Link>
        </div>
      }
    />
  );
}

function TranscriptSection({ code }: { code: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-accent-700 transition-colors"
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Full Transcript
      </button>
      {expanded && <TranscriptList code={code} />}
    </div>
  );
}

function TranscriptList({ code }: { code: string }) {
  const { data, isPending, error } = useQuery(
    meetingTranscriptsQueryOptions(code),
  );

  if (isPending) {
    return (
      <Card variant="glass" className="flex items-center justify-center py-8">
        <Spinner size="md" brand />
      </Card>
    );
  }

  if (error || !data?.transcripts?.length) {
    return (
      <Card variant="glass" className="py-8 text-center text-sm text-neutral-500">
        Transcript unavailable
      </Card>
    );
  }

  return (
    <Card variant="glass" className="space-y-3">
      {data.transcripts.map((line: TranscriptLine) => (
        <div
          key={line.id}
          className="border-b border-neutral-100 pb-3 last:border-0 last:pb-0"
        >
          <div className="mb-1 flex items-center gap-2 text-xs text-neutral-400">
            <span className="font-medium text-neutral-600">{line.participantName}</span>
            {line.startedAt && (
              <span>{new Date(line.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-neutral-700">{line.text}</p>
        </div>
      ))}
    </Card>
  );
}
