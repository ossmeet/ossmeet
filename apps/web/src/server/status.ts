import { createServerFn } from "@tanstack/react-start";
import { enforceRateLimit, getClientIP, getEnv } from "@/server/auth/helpers";
import { fetchServiceUptime, type ServiceUptime } from "@/server/uptimerobot";
import { getWhiteboardStatusMonitors } from "@whiteboard/server";

// ─── Server-side cache (30s TTL) ─────────────────────────────────────
// Prevents every client request from hitting UptimeRobot's API.
// In-memory only — resets on Worker restart, which is fine.

const CACHE_TTL_MS = 30_000;

let cachedAt = 0;
let cachedResult: ServiceUptime[] | null = null;
let cachedFetchedAt: string | null = null;
let inflightFetch: Promise<ServiceUptime[] | null> | null = null;

export type UptimeDataState = "live" | "stale" | "not_configured" | "error";

export interface UptimeStatusResponse {
  services: ServiceUptime[];
  state: UptimeDataState;
  message: string | null;
  /** ISO timestamp of when the Worker last fetched from UptimeRobot. */
  fetchedAt: string | null;
}

async function fetchFresh(): Promise<ServiceUptime[] | null> {
  if (inflightFetch) return inflightFetch;

  inflightFetch = (async () => {
    const env = await getEnv();
    if (!env.UPTIMEROBOT_API_KEY) return null;

    const monitors: Array<{
      service: "livekit" | "whiteboard";
      name: string;
      id?: string | null;
    }> = [{ service: "livekit", name: "Video Meetings", id: env.UPTIMEROBOT_MONITOR_LIVEKIT_ID }];

    const addonMonitors = getWhiteboardStatusMonitors?.(env) ?? [];
    monitors.push(...(addonMonitors as Array<{ service: "livekit" | "whiteboard"; name: string; id?: string | null }>));

    const result = await fetchServiceUptime(env.UPTIMEROBOT_API_KEY, monitors);

    cachedAt = Date.now();
    cachedFetchedAt = new Date(cachedAt).toISOString();
    cachedResult = result;
    return result;
  })().finally(() => {
    inflightFetch = null;
  });

  return inflightFetch;
}

export const getUptimeStatus = createServerFn({ method: "GET" }).handler(async () => {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return {
      services: cachedResult,
      state: "live",
      message: null,
      fetchedAt: cachedFetchedAt,
    } satisfies UptimeStatusResponse;
  }

  try {
    const env = await getEnv();
    await enforceRateLimit(env, `status:uptime:${getClientIP()}`);

    const fresh = await fetchFresh();
    if (fresh === null) {
      return {
        services: [],
        state: "not_configured",
        message: "Status monitoring is not configured.",
        fetchedAt: null,
      } satisfies UptimeStatusResponse;
    }
    return {
      services: fresh,
      state: "live",
      message: null,
      fetchedAt: cachedFetchedAt,
    } satisfies UptimeStatusResponse;
  } catch {
    if (cachedResult) {
      return {
        services: cachedResult,
        state: "stale",
        message: "Showing last known monitor data due to a temporary fetch issue.",
        fetchedAt: cachedFetchedAt,
      } satisfies UptimeStatusResponse;
    }
    return {
      services: [],
      state: "error",
      message: "Unable to load monitor data right now.",
      fetchedAt: null,
    } satisfies UptimeStatusResponse;
  }
});
