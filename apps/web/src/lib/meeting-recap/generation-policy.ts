export const AUTO_GENERATION_INITIAL_DELAY_MS = 5_000;
export const AUTO_GENERATION_MAX_ATTEMPTS = 3;

/** Exponential backoff: 2s → 5s → 10s */
export function autoGenerationRetryDelay(attempt: number): number {
  return Math.min(2_000 * 2.5 ** attempt, 10_000);
}

export type GenerationError =
  | "no_transcript"
  | "ai_not_configured"
  | "llm_failed"
  | "meeting_not_ended";

const TRANSIENT_GENERATION_ERRORS = new Set<GenerationError>([
  "no_transcript",
  "meeting_not_ended",
]);

export function isGenerationError(value: unknown): value is GenerationError {
  return (
    value === "no_transcript" ||
    value === "ai_not_configured" ||
    value === "llm_failed" ||
    value === "meeting_not_ended"
  );
}

export function shouldRetryGenerationError(error: GenerationError, attempt: number): boolean {
  return TRANSIENT_GENERATION_ERRORS.has(error) && attempt + 1 < AUTO_GENERATION_MAX_ATTEMPTS;
}

export function shouldPollForSummary({
  hasSession,
  hasSummary,
  generationError,
  attempt,
}: {
  hasSession: boolean;
  hasSummary: boolean;
  generationError: GenerationError | null;
  attempt: number;
}): boolean {
  return hasSession && !hasSummary && !generationError && attempt < AUTO_GENERATION_MAX_ATTEMPTS;
}

