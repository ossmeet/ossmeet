import { logInfo } from "@/lib/logger-client";

const STORAGE_KEY = "ossmeet.meeting-entry-metrics.v1";
const STALE_AFTER_MS = 10 * 60 * 1000;

type EntryMetricKey =
  | "intentAt"
  | "routeMountedAt"
  | "prejoinReadyAt"
  | "joinRequestedAt"
  | "joinCredentialsReadyAt"
  | "liveKitConnectedAt"
  | "whiteboardReadyAt";

type EntryMetricsState = Partial<Record<EntryMetricKey, number>> & {
  code?: string;
  source?: string;
  flowId?: string;
  loggedStages?: string[];
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function now() {
  return Date.now();
}

function readState(): EntryMetricsState | null {
  if (!canUseStorage()) return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as EntryMetricsState;
    const freshestTimestamp = Math.max(
      parsed.intentAt ?? 0,
      parsed.routeMountedAt ?? 0,
      parsed.prejoinReadyAt ?? 0,
      parsed.joinRequestedAt ?? 0,
      parsed.joinCredentialsReadyAt ?? 0,
      parsed.liveKitConnectedAt ?? 0,
      parsed.whiteboardReadyAt ?? 0,
    );

    if (!freshestTimestamp || now() - freshestTimestamp > STALE_AFTER_MS) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeState(state: EntryMetricsState) {
  if (!canUseStorage()) return;

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
}

function getState() {
  return readState() ?? {
    flowId: `${now()}-${Math.random().toString(36).slice(2, 8)}`,
    loggedStages: [],
  };
}

function duration(from?: number, to?: number) {
  if (!from || !to || to < from) return null;
  return to - from;
}

function emitStage(stage: "livekit" | "whiteboard", state: EntryMetricsState) {
  const loggedStages = new Set(state.loggedStages ?? []);
  if (loggedStages.has(stage)) return;

  loggedStages.add(stage);
  state.loggedStages = [...loggedStages];
  writeState(state);

  logInfo("[MeetingPerf]", {
    stage,
    flowId: state.flowId,
    code: state.code,
    source: state.source,
    intent_to_route_ms: duration(state.intentAt, state.routeMountedAt),
    intent_to_prejoin_ms: duration(state.intentAt, state.prejoinReadyAt),
    join_click_to_credentials_ms: duration(state.joinRequestedAt, state.joinCredentialsReadyAt),
    join_click_to_livekit_ms: duration(state.joinRequestedAt, state.liveKitConnectedAt),
    credentials_to_livekit_ms: duration(state.joinCredentialsReadyAt, state.liveKitConnectedAt),
    join_click_to_whiteboard_ms: duration(state.joinRequestedAt, state.whiteboardReadyAt),
    livekit_to_whiteboard_ms: duration(state.liveKitConnectedAt, state.whiteboardReadyAt),
  });
}

export function beginMeetingEntryFlow(options: { code?: string; source: string }) {
  const state: EntryMetricsState = {
    flowId: `${now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: options.source,
    code: options.code,
    intentAt: now(),
    loggedStages: [],
  };

  writeState(state);
}

export function markMeetingEntryMetric(metric: EntryMetricKey, options?: { code?: string; source?: string }) {
  const state = getState();
  if (!state[metric]) {
    state[metric] = now();
  }

  if (options?.code) state.code = options.code;
  if (options?.source) state.source = options.source;

  writeState(state);

  if (metric === "liveKitConnectedAt") {
    emitStage("livekit", state);
  }

  if (metric === "whiteboardReadyAt") {
    emitStage("whiteboard", state);
  }
}

export function resetMeetingEntryMetrics() {
  if (!canUseStorage()) return;

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
