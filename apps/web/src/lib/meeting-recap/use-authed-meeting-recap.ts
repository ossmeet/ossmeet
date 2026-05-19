import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { meetingSummaryQueryOptions } from "@/queries/meeting-recap";
import { queryKeys } from "@/lib/query-keys";
import { generateMeetingNotes } from "@/server/transcripts/generate-notes";
import type { getRoomLatestSummary } from "@/server/transcripts/room-recap";
import {
  AUTO_GENERATION_INITIAL_DELAY_MS,
  AUTO_GENERATION_MAX_ATTEMPTS,
  autoGenerationRetryDelay,
  type GenerationError,
  isGenerationError,
  shouldPollForSummary,
  shouldRetryGenerationError,
} from "./generation-policy";

export type MeetingRecapSummary = NonNullable<
  Awaited<ReturnType<typeof getRoomLatestSummary>>["summary"]
>;

export function useAuthedMeetingRecap({
  code,
  refreshRecentOnSuccess = false,
}: {
  code: string;
  refreshRecentOnSuccess?: boolean;
}) {
  const queryClient = useQueryClient();
  const [generationError, setGenerationError] = useState<GenerationError | null>(null);
  const [autoGenerationAttempt, setAutoGenerationAttempt] = useState(0);

  const summaryQuery = useQuery({
    ...meetingSummaryQueryOptions(code),
    refetchInterval: (query) => {
      const data = query.state.data;
      return shouldPollForSummary({
        hasSession: Boolean(data?.session),
        hasSummary: Boolean(data?.summary),
        generationError,
        attempt: autoGenerationAttempt,
      })
        ? autoGenerationRetryDelay(autoGenerationAttempt)
        : false;
    },
  });

  const sessionId = summaryQuery.data?.session?.sessionId ?? null;
  const existingSummary: MeetingRecapSummary | null = summaryQuery.data?.summary ?? null;

  const generateMutation = useMutation({
    mutationFn: () => {
      if (!sessionId) throw new Error("No ended meeting session found");
      return generateMeetingNotes({ data: { meetingId: sessionId } });
    },
    onSuccess: async (result) => {
      if (result.error) {
        const error = isGenerationError(result.error) ? result.error : "llm_failed";
        if (shouldRetryGenerationError(error, autoGenerationAttempt)) {
          setGenerationError(null);
          setAutoGenerationAttempt((attempt) => attempt + 1);
          await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.summary(code) });
          return;
        }
        setGenerationError(error);
        return;
      }

      setGenerationError(null);
      setAutoGenerationAttempt(0);
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: queryKeys.rooms.summary(code) }),
      ];
      if (refreshRecentOnSuccess) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.rooms.recent() }));
      }
      await Promise.all(invalidations);
    },
    onError: () => {
      setGenerationError("llm_failed");
    },
  });

  const {
    mutate: generateNotes,
    isPending: isGenerating,
    reset: resetGenerateNotes,
  } = generateMutation;

  useEffect(() => {
    if (!sessionId || existingSummary) {
      setGenerationError(null);
      setAutoGenerationAttempt(0);
      return;
    }
    if (generationError || isGenerating) return;
    if (autoGenerationAttempt >= AUTO_GENERATION_MAX_ATTEMPTS) {
      setGenerationError("no_transcript");
      return;
    }

    const delay =
      autoGenerationAttempt === 0
        ? AUTO_GENERATION_INITIAL_DELAY_MS
        : autoGenerationRetryDelay(autoGenerationAttempt - 1);

    const timeout = window.setTimeout(() => {
      generateNotes();
    }, delay);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    autoGenerationAttempt,
    existingSummary,
    generationError,
    generateNotes,
    isGenerating,
    sessionId,
  ]);

  useEffect(() => {
    if (!existingSummary) return;
    setGenerationError(null);
  }, [existingSummary]);

  return {
    summaryData: summaryQuery.data,
    summaryError: summaryQuery.error,
    existingSummary,
    generationError,
    isGenerating,
    isPreparingSummary: Boolean(summaryQuery.data?.session) && !existingSummary && !generationError,
    retryGeneration: () => {
      setGenerationError(null);
      setAutoGenerationAttempt(0);
      resetGenerateNotes();
      generateNotes();
    },
    retrySummaryLoad: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.summary(code) }),
  };
}

