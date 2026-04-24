// ─── UptimeRobot Uptime API client ───────────────────────────────────
// Uses POST /v2/getMonitors with logs (down events) to reconstruct per-day
// uptime bars, custom_uptime_ratios for the 90-day SLA figure, and
// recent incident history.

const BASE = "https://api.uptimerobot.com/v2";

// ─── API response shapes ─────────────────────────────────────────────

interface UrLog {
  type: number; // 1=down, 2=up, 98=started, 99=paused
  datetime: number; // Unix timestamp
  duration: number; // seconds; 0 = ongoing
  reason?: { code: number; detail?: string };
}

interface UrMonitor {
  id: number;
  friendly_name: string;
  url: string;
  type: number;
  status: number; // 0=paused, 1=notChecked, 2=up, 8=seemsDown, 9=down
  average_response_time: string;
  custom_uptime_ratio: string; // e.g. "99.99"
  create_datetime: number; // Unix timestamp
  interval: number; // check interval in seconds
  logs?: UrLog[];
}

interface UrResponse {
  stat: "ok" | "fail";
  monitors?: UrMonitor[];
  error?: { type: string; message: string };
}

// ─── Exported domain types ────────────────────────────────────────────

export type ServiceStatus = "up" | "down" | "unknown";

export interface DayUptime {
  date: string; // YYYY-MM-DD
  uptimePct: number; // 0–100, or -1 = no data (before monitor existed)
  hasIncident: boolean;
}

export interface RecentIncident {
  id: string;
  cause: string | null;
  startedAt: string;
  resolvedAt: string | null;
  regions: string[];
}

export interface ServiceUptime {
  service: "livekit" | "whiteboard";
  name: string;
  status: ServiceStatus;
  days: DayUptime[];
  overallPct: number;
  overallPctDisplay: string;
  recentIncidents: RecentIncident[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildFallbackService(
  monitor: { service: "livekit" | "whiteboard"; name: string },
  allDates: string[],
): ServiceUptime {
  return {
    service: monitor.service,
    name: monitor.name,
    status: "unknown",
    days: allDates.map((date) => ({ date, uptimePct: -1, hasIncident: false })),
    overallPct: 0,
    overallPctDisplay: "0",
    recentIncidents: [],
  };
}

async function urFetch(apiKey: string, params: Record<string, string>): Promise<UrResponse> {
  const body = new URLSearchParams({ api_key: apiKey, format: "json", ...params });
  const res = await fetch(`${BASE}/getMonitors`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`UptimeRobot ${res.status}: ${res.statusText}`);
  const data = (await res.json()) as UrResponse;
  if (data.stat !== "ok") throw new Error(`UptimeRobot error: ${data.error?.message ?? "unknown"}`);
  return data;
}

// ─── Day-bar builder (from down-event logs) ───────────────────────────

export function buildDays(
  logs: UrLog[],
  allDates: string[],
  createDatetime: number,
  nowMs = Date.now(),
): DayUptime[] {
  const DAY_MS = 86_400_000;
  const createdAtMs = createDatetime * 1000;
  const downMs = new Map<string, number>();

  return allDates.map((date) => {
    const dayStartMs = new Date(`${date}T00:00:00.000Z`).getTime();
    const dayEndMs = dayStartMs + DAY_MS;
    const monitorStartMs = Math.max(dayStartMs, createdAtMs);
    const monitorEndMs = Math.min(dayEndMs, nowMs);

    if (monitorStartMs >= monitorEndMs) {
      return { date, uptimePct: -1, hasIncident: false };
    }

    for (const log of logs) {
      if (log.type !== 1) continue; // only down events
      const startMs = log.datetime * 1000;
      const durationMs = log.duration > 0 ? log.duration * 1000 : nowMs - startMs;
      const endMs = startMs + durationMs;
      const from = Math.max(startMs, monitorStartMs);
      const to = Math.min(endMs, monitorEndMs);
      if (from < to) downMs.set(date, (downMs.get(date) ?? 0) + (to - from));
    }

    const monitoredMs = monitorEndMs - monitorStartMs;
    const down = Math.min(downMs.get(date) ?? 0, monitoredMs);
    return {
      date,
      uptimePct: down === 0 ? 100 : Math.max(0, ((monitoredMs - down) / monitoredMs) * 100),
      hasIncident: down > 0,
    };
  });
}

// ─── Main data fetcher ───────────────────────────────────────────────

export async function fetchServiceUptime(
  apiKey: string,
  monitors: Array<{ service: "livekit" | "whiteboard"; name: string; id?: string | null }>,
): Promise<ServiceUptime[]> {
  const cutoffMs = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 89);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();

  const allDates: string[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    allDates.push(d.toISOString().slice(0, 10));
  }

  const validMonitors = monitors.filter((m) => m.id?.trim());
  if (validMonitors.length === 0) {
    return monitors.map((m) => buildFallbackService(m, allDates));
  }

  const data = await urFetch(apiKey, {
    monitors: validMonitors.map((m) => m.id!.trim()).join("-"),
    custom_uptime_ratios: "90",
    logs: "1",
    logs_limit: "500",
  });

  return monitors.map((monitor) => {
    if (!monitor.id?.trim()) return buildFallbackService(monitor, allDates);

    const ur = data.monitors?.find((m) => String(m.id) === monitor.id!.trim());
    if (!ur) return buildFallbackService(monitor, allDates);

    const status: ServiceStatus =
      ur.status === 2 ? "up" : ur.status === 8 || ur.status === 9 ? "down" : "unknown";

    const allLogs = ur.logs ?? [];
    const downLogs = allLogs.filter(
      (l) => l.type === 1 && l.datetime * 1000 >= cutoffMs,
    );

    const days = buildDays(allLogs, allDates, ur.create_datetime);
    const overallPct = parseFloat(ur.custom_uptime_ratio) || 0;
    const overallPctDisplay = ur.custom_uptime_ratio || "0";

    const recentIncidents: RecentIncident[] = downLogs
      .slice()
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, 10)
      .map((log) => ({
        id: String(log.datetime),
        cause: log.reason?.detail ?? null,
        startedAt: new Date(log.datetime * 1000).toISOString(),
        resolvedAt:
          log.duration > 0
            ? new Date((log.datetime + log.duration) * 1000).toISOString()
            : null,
        regions: [],
      }));

    return {
      service: monitor.service,
      name: monitor.name,
      status,
      days,
      overallPct,
      overallPctDisplay,
      recentIncidents,
    };
  });
}
