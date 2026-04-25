import { useState } from "react";
import { createLazyFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useQueryErrorResetBoundary,
} from "@tanstack/react-query";
import { generateMeetingNotes } from "@/server/transcripts/generate-notes";
import { meetingSummaryQueryOptions, meetingTranscriptsQueryOptions } from "@/queries/meeting-recap";
import { queryKeys } from "@/lib/query-keys";
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

interface SummaryData {
  id: string;
  summary: string;
  topics: string[];
  actionItems: string[];
  decisions: string[];
  durationSeconds: number | null;
  participantCount: number | null;
  createdAt: Date | null;
}

type GenerationError = "no_transcript" | "ai_not_configured" | "llm_failed" | "meeting_not_ended";

function RoomDashboardPage() {
  const { code } = Route.useParams();
  const queryClient = useQueryClient();

  const { data: summaryData } = useQuery(meetingSummaryQueryOptions(code));

  const [generationError, setGenerationError] = useState<GenerationError | null>(null);
  const sessionId = summaryData?.session?.sessionId ?? null;

  const generateMutation = useMutation({
    mutationFn: () => {
      if (!sessionId) throw new Error("No ended session found for this room");
      return generateMeetingNotes({ data: { meetingId: sessionId } });
    },
    onSuccess: (result) => {
      if (result.error) {
        setGenerationError(result.error as GenerationError);
        return;
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.summary(code) });
    },
    onError: () => {
      setGenerationError("llm_failed");
    },
  });

  const existingSummary: SummaryData | null = summaryData?.summary ?? null;

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

  // Loading state
  if (generateMutation.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-accent-700 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Dashboard
        </Link>
        <div className="flex flex-col items-center justify-center py-24">
          <div className="mb-6 rounded-2xl bg-accent-100 p-4">
            <Sparkles size={32} className="text-accent-700 animate-pulse" />
          </div>
          <Spinner size="lg" brand />
          <p className="mt-4 text-base font-semibold text-neutral-900">
            Generating your meeting summary...
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            Analyzing transcript data with AI
          </p>
        </div>
      </div>
    );
  }

  // Manual trigger state (no auto-generation)
  if (!existingSummary && !generationError && !generateMutation.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-accent-700 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Dashboard
        </Link>
        <EmptyState
          icon={Sparkles}
          title="Summary not generated yet"
          description="Generate an AI summary for this meeting recap."
          action={(
            <Button
              size="sm"
              onClick={() => generateMutation.mutate()}
            >
              <Sparkles size={14} className="mr-1.5" />
              Generate summary
            </Button>
          )}
        />
      </div>
    );
  }

  // Error states
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
          error={generationError ?? "llm_failed"}
          onRetry={() => {
            setGenerationError(null);
            generateMutation.reset();
          }}
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

      {/* Header */}
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

      {/* Summary card */}
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

      {/* Topics */}
      {existingSummary.topics.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {existingSummary.topics.map((topic) => (
            <Badge key={topic} variant="primary" size="md" dot>
              {topic}
            </Badge>
          ))}
        </div>
      )}

      {/* Action Items & Decisions */}
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

      {/* Meta bar */}
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

      {/* Expandable transcript */}
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
  const { data, isLoading, error } = useQuery(
    meetingTranscriptsQueryOptions(code)
  );

  if (isLoading) {
    return (
      <Card variant="glass" className="flex items-center justify-center py-8">
        <Spinner size="md" brand />
      </Card>
    );
  }

  if (error || !data?.transcripts?.length) {
    return (
      <Card variant="glass" className="py-6 text-center text-sm text-neutral-500">
        No transcript data available.
      </Card>
    );
  }

  return (
    <Card variant="glass" className="max-h-96 overflow-y-auto">
      <div className="space-y-3">
        {data.transcripts.map((line: TranscriptLine) => (
          <div key={line.id} className="flex gap-3 text-sm">
            <span className="shrink-0 font-medium text-accent-700 min-w-[100px]">
              {line.participantName}
            </span>
            <span className="text-neutral-700">{line.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
