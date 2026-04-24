import { createLazyFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  RefreshCw,
  Video,
  PenTool,
  CheckCircle,
  AlertTriangle,
  Clock,
  Globe,
  Zap,
  AlertCircle,
} from "lucide-react";
import { useEffect, useState, useCallback, useRef, lazy } from "react";
import { getUptimeStatus, type UptimeDataState } from "@/server/status";
import { UptimeBar } from "@/components/status/uptime-bar";
import type { ServiceUptime, ServiceStatus, RecentIncident } from "@/server/uptimerobot";

export const Route = createLazyFileRoute("/status")({
  component: StatusPage,
});

// ─── Shared helpers ──────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function regionLabel(code: string): string {
  const map: Record<string, string> = { us: "US", eu: "EU", as: "Asia", au: "Oceania" };
  return map[code] ?? code.toUpperCase();
}

function isAbortLikeError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    return message.includes("aborted") || message.includes("abort");
  }
  return false;
}

// ─── Sub-components ──────────────────────────────────────────────────

const BrandMark = lazy(() =>
  import("@/components/brand-mark").then((m) => ({ default: m.BrandMark }))
);

function PulseIndicator({ status }: { status: ServiceStatus | "loading" }) {
  const dot =
    status === "up" ? "bg-success-500" : status === "down" ? "bg-danger-500" : "bg-neutral-300";
  const ring =
    status === "up"
      ? "ring-success-500/25"
      : status === "down"
        ? "ring-danger-500/25"
        : "ring-neutral-300/25";
  return (
    <span className="relative flex h-3 w-3" aria-hidden="true">
      {status === "up" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-400 opacity-40" />
      )}
      <span className={`relative inline-flex h-3 w-3 rounded-full ${dot} ring-4 ${ring}`} />
    </span>
  );
}

function StatusBadge({ status }: { status: ServiceStatus | "loading" }) {
  const config: Record<string, { label: string; classes: string }> = {
    up: { label: "Operational", classes: "bg-success-50 text-success-700 border-success-200" },
    down: { label: "Outage", classes: "bg-danger-50 text-danger-700 border-danger-200" },
    unknown: { label: "Unknown", classes: "bg-neutral-50 text-neutral-500 border-neutral-200" },
    loading: { label: "Checking...", classes: "bg-neutral-50 text-neutral-400 border-neutral-200" },
  };
  const { label, classes } = config[status] ?? config.unknown;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${classes}`}
      role="status"
      aria-label={label}
    >
      {label}
    </span>
  );
}

function IncidentRow({ incident }: { incident: RecentIncident }) {
  const isOngoing = !incident.resolvedAt;
  const duration = isOngoing
    ? null
    : Math.round(
        (new Date(incident.resolvedAt!).getTime() - new Date(incident.startedAt).getTime()) / 1000,
      );

  return (
    <div className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="mt-1">
        {isOngoing ? (
          <AlertCircle className="h-3.5 w-3.5 text-danger-500" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-warning-500" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-neutral-700">
          {incident.cause ?? "Service degraded"}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-neutral-400">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" aria-hidden="true" />
            {formatRelativeTime(incident.startedAt)}
          </span>
          {duration !== null && (
            <span className="inline-flex items-center gap-1">
              <Zap className="h-2.5 w-2.5" aria-hidden="true" />
              {formatDuration(duration)}
            </span>
          )}
          {incident.regions.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Globe className="h-2.5 w-2.5" aria-hidden="true" />
              {incident.regions.map(regionLabel).join(", ")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ServiceCard({ service }: { service: ServiceUptime | null }) {
  const isLoading = service === null;

  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white px-5 py-4 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-card">
      <div className="flex items-start gap-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            isLoading
              ? "bg-neutral-100 text-neutral-400"
              : service!.status === "up"
                ? "bg-success-50 text-success-600"
                : service!.status === "down"
                  ? "bg-danger-50 text-danger-600"
                  : "bg-neutral-100 text-neutral-500"
          }`}
          aria-hidden="true"
        >
          {service?.service === "whiteboard" ? (
            <PenTool className="h-5 w-5" />
          ) : (
            <Video className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-heading text-sm font-bold text-neutral-900">
              {isLoading ? (
                <span className="inline-block h-4 w-28 animate-pulse rounded bg-neutral-100" />
              ) : (
                service!.name
              )}
            </h3>
            <StatusBadge status={isLoading ? "loading" : service!.status} />
          </div>

          <div className="mt-2.5 flex items-center gap-3">
            <PulseIndicator status={isLoading ? "loading" : service!.status} />
          </div>

          {isLoading ? (
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <div className="h-10 animate-pulse rounded bg-neutral-100" />
            </div>
          ) : (
            <>
              {service!.status === "unknown" ? (
                <div className="mt-3 border-t border-neutral-100 pt-3">
                  <p className="text-xs text-neutral-500">Uptime data unavailable for this service.</p>
                </div>
              ) : (
                <UptimeBar
                  days={service!.days}
                  overallPct={service!.overallPct}
                  overallPctDisplay={service!.overallPctDisplay}
                />
              )}
              {service!.recentIncidents.length > 0 && (
                <div className="mt-3 border-t border-neutral-100 pt-3">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-neutral-400">
                    Recent incidents
                  </p>
                  {service!.recentIncidents.map((inc) => (
                    <IncidentRow key={inc.id} incident={inc} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OverallBanner({
  services,
  dataState,
}: {
  services: ServiceUptime[] | null;
  dataState: UptimeDataState | "loading";
}) {
  if (!services) {
    return (
      <div className="bento-card flex items-center gap-3 px-6 py-5">
        <div
          className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600"
          aria-hidden="true"
        />
        <p className="text-base font-medium text-neutral-600">Checking service health...</p>
      </div>
    );
  }

  if (dataState === "not_configured") {
    return (
      <div className="bento-card flex items-center gap-3 border-neutral-200 bg-neutral-50 px-6 py-5">
        <AlertCircle className="h-5 w-5 text-neutral-400" aria-hidden="true" />
        <p className="text-base font-medium text-neutral-600">Status monitoring is not configured.</p>
      </div>
    );
  }

  if (services.length === 0 || dataState === "error") {
    return (
      <div className="bento-card flex items-center gap-3 border-warning-200 bg-warning-50 px-6 py-5">
        <AlertTriangle className="h-5 w-5 text-warning-600" aria-hidden="true" />
        <p className="text-base font-medium text-warning-800">Status data is currently unavailable.</p>
      </div>
    );
  }

  const anyDown = services.some((s) => s.status === "down");
  if (anyDown) {
    return (
      <div
        className="bento-card relative overflow-hidden border-danger-200 bg-danger-50 px-6 py-5 shadow-elevated"
        role="alert"
      >
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-danger-400/20 blur-[80px]" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-danger-100 text-danger-600">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-lg font-bold text-danger-900">Partial outage detected</p>
            <p className="mt-0.5 text-sm font-medium text-danger-700/80">
              One or more services are currently unavailable.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const anyUnknown = services.some((s) => s.status === "unknown");
  if (anyUnknown || dataState === "stale") {
    return (
      <div className="bento-card flex items-center gap-3 border-warning-200 bg-warning-50 px-6 py-5">
        <AlertTriangle className="h-5 w-5 text-warning-600" aria-hidden="true" />
        <p className="text-base font-medium text-warning-800">
          Monitoring data is partially unavailable.
        </p>
      </div>
    );
  }

  return (
    <div className="liquid-glass-glow relative overflow-hidden rounded-[24px] border-success-200 px-5 py-4 shadow-aura-glow">
      <div className="pointer-events-none absolute left-0 top-0 h-full w-full bg-success-50/50" />
      <div className="absolute -left-10 -top-10 h-32 w-32 rounded-full bg-success-400/20 blur-[50px]" />
      <div className="relative flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-100 text-success-600">
          <CheckCircle className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-base font-bold text-success-900">All systems operational</p>
          <p className="mt-0.5 text-xs font-medium text-success-700/80">
            Servers are running smoothly.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Auto-refresh interval ───────────────────────────────────────────

const AUTO_REFRESH_MS = 60_000;

// ─── Main page ───────────────────────────────────────────────────────

function StatusPage() {
  const [services, setServices] = useState<ServiceUptime[] | null>(null);
  const [dataState, setDataState] = useState<UptimeDataState | "loading">("loading");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const load = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;

    const request = (async () => {
      setIsRefreshing(true);
      setError(null);

      try {
        const data = await getUptimeStatus();
        setServices(data.services);
        setDataState(data.state);
        setFetchedAt(data.fetchedAt);
        setError(data.state === "live" ? null : data.message ?? null);
      } catch (err) {
        if (isAbortLikeError(err)) return;
        setDataState("error");
        setError("Failed to load uptime data. Please try again.");
      } finally {
        setIsRefreshing(false);
      }
    })();

    inFlightRef.current = request;
    try {
      await request;
    } finally {
      if (inFlightRef.current === request) inFlightRef.current = null;
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(intervalRef.current);
  }, [load]);

  const displayServices: Array<ServiceUptime | null> =
    services ?? [null, null];

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas font-sans text-neutral-900 bg-dot-grid">
      {/* Ambient background effects */}
      <div className="liquid-blob-teal -left-32 top-0 h-[600px] w-[600px] opacity-40 mix-blend-multiply" />
      <div className="liquid-blob-amber -right-32 top-[20%] h-[500px] w-[500px] opacity-30 mix-blend-multiply" />

      <header className="relative z-50 px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-700">
              <BrandMark className="h-4 w-4 text-white" />
            </div>
            <span className="font-heading text-lg font-bold tracking-tight text-neutral-900">
              OSSMeet
            </span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-neutral-600 transition-colors hover:text-accent-700"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl animate-fade-in px-6 pb-12 pt-6 sm:pt-8">
        <div className="mb-6">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-neutral-900">
            Service Status
          </h1>
          <p className="mt-2 text-neutral-600">
            Live status and 90-day uptime history for OSSMeet infrastructure.
          </p>
        </div>

        <OverallBanner services={services} dataState={dataState} />

        <div className="mt-5 grid gap-3" role="list" aria-label="Service status cards">
          {displayServices.map((service, i) => (
            <div key={service?.service ?? i} role="listitem">
              <ServiceCard service={service} />
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between rounded-2xl border border-neutral-200/80 bg-white px-5 py-3 shadow-soft">
          {services && services.length > 0 ? (
            <div className="text-xs text-neutral-400">
              <p>
                Status data as of{" "}
                <span className="font-medium text-neutral-500">
                  {fetchedAt
                    ? new Date(fetchedAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })
                    : "Unknown"}
                </span>
              </p>
              <p className="mt-0.5">
                Last time this server fetched from UptimeRobot (shown in your local time)
              </p>
            </div>
          ) : services ? (
            <p className="text-xs text-neutral-400">
              {dataState === "not_configured"
                ? "Status monitoring is not configured"
                : dataState === "error"
                  ? "Status data unavailable"
                  : "No monitor data available"}
            </p>
          ) : (
            <p className="text-xs text-neutral-400">Loading...</p>
          )}
          <button
            onClick={load}
            disabled={isRefreshing}
            aria-busy={isRefreshing}
            aria-label="Refresh status"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-accent-700 transition-all hover:bg-accent-50 disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={isRefreshing ? "animate-spin" : ""}
              aria-hidden="true"
            />
            Refresh
          </button>
        </div>

        {error && (
          <div
            className={`mt-4 rounded-2xl px-5 py-3 ${
              dataState === "error"
                ? "border border-danger-200 bg-danger-50"
                : "border border-warning-200 bg-warning-50"
            }`}
            role="alert"
          >
            <p className={`text-sm ${dataState === "error" ? "text-danger-700" : "text-warning-800"}`}>
              {error}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
