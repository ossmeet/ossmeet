import "@tanstack/react-start/server-only";
import { EgressStatus } from "livekit-server-sdk";
import type { EgressClient, EgressInfo } from "livekit-server-sdk";
import { logError } from "@/lib/logger";
import { withTimeout } from "@/lib/with-timeout";

const STREAM_INFO_STATUS_ACTIVE = 0;
const STREAM_INFO_STATUS_FAILED = 2;
const EGRESS_STARTUP_TIMEOUT_MS = 30_000;
const EGRESS_STARTUP_POLL_MS = 1_000;

export const ACTIVE_EGRESS_STATUSES = new Set([
  EgressStatus.EGRESS_STARTING,
  EgressStatus.EGRESS_ACTIVE,
  EgressStatus.EGRESS_ENDING,
]);

export type EgressTaskStartResult = { egressId: string } | { error: string };

const FAILED_EGRESS_STATUSES = new Set([
  EgressStatus.EGRESS_FAILED,
  EgressStatus.EGRESS_ABORTED,
  EgressStatus.EGRESS_LIMIT_REACHED,
]);

export function isActiveEgressStatus(status: EgressStatus | number | undefined): boolean {
  return status !== undefined && ACTIVE_EGRESS_STATUSES.has(status as EgressStatus);
}

export function isMissingEgressError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("not found") || message.includes("does not exist");
}

type EgressLifecycleClient = Pick<EgressClient, "listEgress" | "stopEgress">;

export interface StartRoomCompositeEgressWithRecoveryOptions {
  egressClient: EgressLifecycleClient;
  roomName: string;
  logPrefix: string;
  requireStreamOutput: boolean;
  start: () => Promise<EgressInfo>;
  clearStartingState: () => Promise<void>;
  commitStartedEgress: (egressId: string) => Promise<boolean>;
}

type EgressStartupResult =
  | { ok: true; info: EgressInfo }
  | { ok: false; info?: EgressInfo; message: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStreamOutputFailure(info: EgressInfo): string | null {
  const failedStream = info.streamResults.find((stream) => stream.status === STREAM_INFO_STATUS_FAILED);
  if (!failedStream) return null;
  return failedStream.error || "The streaming destination rejected the stream.";
}

function classifyEgressStartup(
  info: EgressInfo,
  { requireStreamOutput }: { requireStreamOutput: boolean },
): EgressStartupResult | null {
  const streamFailure = getStreamOutputFailure(info);
  if (streamFailure) return { ok: false, info, message: streamFailure };

  if (FAILED_EGRESS_STATUSES.has(info.status)) {
    return {
      ok: false,
      info,
      message: info.error || info.details || "LiveKit egress failed before it became active.",
    };
  }

  if (info.status === EgressStatus.EGRESS_ACTIVE) {
    if (!requireStreamOutput) return { ok: true, info };

    const hasActiveStream = info.streamResults.some((stream) => stream.status === STREAM_INFO_STATUS_ACTIVE);
    if (hasActiveStream || info.streamResults.length === 0) return { ok: true, info };
  }

  return null;
}

export async function waitForEgressStartup(
  egressClient: Pick<EgressClient, "listEgress">,
  initialInfo: EgressInfo,
  options: {
    requireStreamOutput: boolean;
    timeoutMs?: number;
    pollMs?: number;
  },
): Promise<EgressStartupResult> {
  const timeoutMs = options.timeoutMs ?? EGRESS_STARTUP_TIMEOUT_MS;
  const pollMs = options.pollMs ?? EGRESS_STARTUP_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  let latest = initialInfo;

  while (Date.now() <= deadline) {
    const classified = classifyEgressStartup(latest, options);
    if (classified) return classified;

    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));

    let egresses: EgressInfo[];
    try {
      egresses = await withTimeout(egressClient.listEgress({ egressId: initialInfo.egressId }), 5_000);
    } catch {
      return {
        ok: false,
        info: latest,
        message: "Could not verify LiveKit egress startup.",
      };
    }
    const next = egresses.find((egress) => egress.egressId === initialInfo.egressId);
    if (!next) {
      return {
        ok: false,
        info: latest,
        message: "LiveKit egress stopped before it became active.",
      };
    }
    latest = next;
  }

  return {
    ok: false,
    info: latest,
    message: "LiveKit egress did not become active in time.",
  };
}

export async function startRoomCompositeEgressWithRecovery({
  egressClient,
  roomName,
  logPrefix,
  requireStreamOutput,
  start,
  clearStartingState,
  commitStartedEgress,
}: StartRoomCompositeEgressWithRecoveryOptions): Promise<EgressTaskStartResult | null> {
  let info: EgressInfo;
  try {
    info = await start();
  } catch (err) {
    logError(`${logPrefix} Egress start failed, clearing sentinel:`, err);
    await stopActiveRoomEgresses(egressClient, roomName, logPrefix);
    await clearStartingState().catch((clearErr) => {
      logError(`${logPrefix} Failed to clear sentinel after egress failure:`, clearErr);
    });
    return { error: "LiveKit egress did not start." };
  }

  const startup = await waitForEgressStartup(egressClient, info, { requireStreamOutput });
  if (!startup.ok) {
    logError(`${logPrefix} Egress did not become active, clearing sentinel:`, startup.message);
    if (isActiveEgressStatus(startup.info?.status)) {
      await egressClient.stopEgress(info.egressId).catch((stopErr) => {
        logError(`${logPrefix} Failed to stop inactive egress after startup check:`, stopErr);
      });
    }
    await clearStartingState().catch((clearErr) => {
      logError(`${logPrefix} Failed to clear sentinel after inactive egress:`, clearErr);
    });
    return { error: startup.message };
  }

  info = startup.info;

  const committed = await commitStartedEgress(info.egressId);
  if (!committed) {
    await egressClient.stopEgress(info.egressId).catch((stopErr) => {
      logError(`${logPrefix} Failed to stop orphaned egress after lost sentinel ownership:`, stopErr);
    });
    return null;
  }

  return { egressId: info.egressId };
}

async function stopActiveRoomEgresses(
  egressClient: EgressLifecycleClient,
  roomName: string,
  logPrefix: string,
): Promise<void> {
  try {
    const runningEgresses = await withTimeout(egressClient.listEgress({ roomName }), 10_000);
    for (const egress of runningEgresses) {
      if (isActiveEgressStatus(egress.status)) {
        await egressClient.stopEgress(egress.egressId).catch((stopErr) => {
          logError(`${logPrefix} Failed to stop post-timeout egress:`, stopErr);
        });
      }
    }
  } catch {
    // Sentinel cleanup is the primary recovery path; room cleanup is best effort.
  }
}
