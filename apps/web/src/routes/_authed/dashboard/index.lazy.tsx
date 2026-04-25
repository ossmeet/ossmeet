import { Suspense, useEffect, useState } from "react";
import { createLazyFileRoute, useRouter, CatchBoundary } from "@tanstack/react-router";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Spinner } from "@/components/ui/spinner";
import { RecentMeetings } from "@/components/dashboard/recent-meetings";
import { SpacesWidget } from "@/components/dashboard/spaces-widget";
import { ActiveNow } from "@/components/dashboard/active-now";
import { PermanentRoomDialog } from "@/components/dashboard/permanent-room-dialog";
import { Video, Keyboard, Link2 } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createMeeting } from "@/server/meetings/crud";
import { beginMeetingEntryFlow } from "@/lib/meeting/entry-metrics";
import { preloadMeetingRoute, scheduleIdleTask } from "@/lib/meeting/preload-route";
import { getPlanLimits } from "@ossmeet/shared";
import { sessionQueryOptions } from "@/queries/session";
import { getErrorMessage } from "@/lib/errors";

const CODE_REGEX = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

function formatCode(raw: string): string {
  const letters = raw.replace(/[^a-z]/g, "").slice(0, 10);
  if (letters.length <= 3) return letters;
  if (letters.length <= 7) return `${letters.slice(0, 3)}-${letters.slice(3)}`;
  return `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`;
}

export const Route = createLazyFileRoute("/_authed/dashboard/")({
  component: DashboardPage,
  pendingComponent: () => (
    <div className="flex h-64 items-center justify-center">
      <Spinner size="lg" brand />
    </div>
  ),
  errorComponent: DashboardError,
});

function DashboardError({ error }: { error: Error }) {
  const router = useRouter();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-neutral-500">{error.message || "Failed to load dashboard"}</p>
      <button
        onClick={() => {
          queryErrorResetBoundary.reset();
          router.invalidate();
        }}
        className="text-sm font-medium text-accent-700 hover:text-accent-800"
      >
        Retry
      </button>
    </div>
  );
}

function getGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function DashboardPage() {
  const router = useRouter();
  const { session } = Route.useRouteContext();
  const firstName = session.user.name?.split(" ")[0] ?? "there";
  const [now, setNow] = useState<Date | null>(null);

  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [permanentDialogOpen, setPermanentDialogOpen] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => setNow(new Date()), []);

  const handleMeetingIntent = () => {
    preloadMeetingRoute(router).catch(() => {});
  };

  useEffect(() => {
    return scheduleIdleTask(() => {
      preloadMeetingRoute(router).catch(() => {});
    });
  }, [router]);

  const { data: sessionData } = useQuery(sessionQueryOptions());
  const userPlan = sessionData?.user?.plan ?? "free";
  const planLimits = getPlanLimits(userPlan);
  const canRecord = planLimits.recordingEnabled;

  const createMutation = useMutation({
    mutationFn: (permanent: boolean) =>
      createMeeting({
        data: {
          allowGuests: true,
          recordingEnabled: canRecord,
          permanent,
        },
      }),
    onMutate: () => {
      setCreateError("");
      beginMeetingEntryFlow({ source: "dashboard-create" });
      handleMeetingIntent();
    },
    onSuccess: (result) => {
      window.location.href = `/${result.code}`;
    },
    onError: (error) => {
      setCreateError(getErrorMessage(error, "Failed to create meeting. Please try again."));
    },
  });

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setJoinError("");
    if (!CODE_REGEX.test(code)) {
      setJoinError("Invalid code.");
      return;
    }
    setIsJoining(true);
    beginMeetingEntryFlow({ source: "dashboard-join", code });
    window.location.href = `/${code}`;
  }

  const greeting = now ? getGreeting(now.getHours()) : "Welcome";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 font-heading">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-stone-500 font-medium">Here's what's happening today.</p>
        </div>
      </div>

      {/* Action Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="animate-fade-in-up" style={{ animationDelay: "0ms" }}>
          <button
            onClick={() => createMutation.mutate(false)}
            disabled={createMutation.isPending}
            onPointerEnter={handleMeetingIntent}
            className="group flex w-full flex-col items-center justify-center gap-3 bg-white p-6 rounded-[1.25rem] ring-1 ring-black/5 shadow-sm hover:shadow-card hover:-translate-y-0.5 transition-all disabled:opacity-70 disabled:pointer-events-none"
          >
            <div className="h-12 w-12 rounded-full bg-teal-50 flex items-center justify-center text-teal-600 group-hover:scale-110 group-hover:bg-teal-600 group-hover:text-white transition-all duration-300">
              {createMutation.isPending ? <Spinner className="w-5 h-5 text-teal-600 group-hover:text-white" /> : <Video size={22} />}
            </div>
            <span className="font-semibold text-[13px] text-stone-700">New Meeting</span>
          </button>
          {createError && (
            <p className="mt-2 text-center text-xs font-semibold text-red-600">{createError}</p>
          )}
        </div>

        <form
          onSubmit={handleJoin}
          className="group relative flex flex-col items-center justify-between gap-3 bg-white p-4 rounded-[1.25rem] ring-1 ring-black/5 shadow-sm hover:shadow-card transition-all animate-fade-in-up"
          style={{ animationDelay: "50ms" }}
        >
          <input
            value={code}
            onChange={(e) => { setJoinError(""); setCode(formatCode(e.target.value.toLowerCase())); }}
            placeholder="abc-defg-hij"
            autoComplete="off"
            spellCheck={false}
            className="w-full text-center bg-stone-50 border border-stone-200/60 rounded-xl h-11 px-3 text-sm font-mono tracking-wider focus:outline-hidden focus:ring-2 focus:ring-teal-500/30"
          />
          {joinError && <span className="absolute -bottom-5 text-[10px] uppercase font-bold tracking-widest text-red-500">{joinError}</span>}
          <button
            type="submit"
            disabled={!code || isJoining}
            onPointerEnter={handleMeetingIntent}
            className="text-[13px] font-semibold text-stone-600 hover:text-teal-700 transition-colors w-full h-8 flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Keyboard size={16} /> Join Room
          </button>
        </form>

        <button
          onClick={() => setPermanentDialogOpen(true)}
          className="group flex flex-col items-center justify-center gap-3 bg-white p-6 rounded-[1.25rem] ring-1 ring-black/5 shadow-sm hover:shadow-card hover:-translate-y-0.5 transition-all animate-fade-in-up"
          style={{ animationDelay: "100ms" }}
        >
          <div className="h-12 w-12 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 group-hover:scale-110 group-hover:bg-stone-800 group-hover:text-white transition-all duration-300">
            <Link2 size={22} />
          </div>
          <span className="font-semibold text-[13px] text-stone-700">Permanent Room</span>
        </button>
      </div>

      <PermanentRoomDialog open={permanentDialogOpen} onOpenChange={setPermanentDialogOpen} />
      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 auto-rows-[minmax(80px,auto)] gap-6">
        
        {/* Active Now - Priority placement if exists, otherwise flows normally */}
        <div className="col-span-1 md:col-span-12 lg:col-span-8">
          <CatchBoundary getResetKey={() => "active"} errorComponent={DashboardError}>
            <Suspense fallback={null}>
              <ActiveNow />
            </Suspense>
          </CatchBoundary>
        </div>

        {/* Recent Meetings */}
        <div className="col-span-1 md:col-span-12 lg:col-span-7">
          <CatchBoundary getResetKey={() => "recent"} errorComponent={DashboardError}>
            <Suspense fallback={null}>
              <RecentMeetings />
            </Suspense>
          </CatchBoundary>
        </div>

        {/* Spaces Widget */}
        <div className="col-span-1 md:col-span-12 lg:col-span-5 h-full">
          <CatchBoundary getResetKey={() => "spaces"} errorComponent={DashboardError}>
            <Suspense fallback={null}>
              <SpacesWidget />
            </Suspense>
          </CatchBoundary>
        </div>
      </div>
    </div>
  );
}
