import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useCallback, lazy } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPlanLimits } from "@ossmeet/shared";
import { useIdleEnabled } from "@/lib/hooks/use-idle-enabled";
import { beginMeetingEntryFlow } from "@/lib/meeting/entry-metrics";
import { preloadMeetingRoute } from "@/lib/meeting/preload-route";
import { createMeeting } from "@/server/meetings/crud";
import { sessionQueryOptions } from "@/queries/session";
import { getErrorMessage } from "@/lib/errors";

const SITE_URL = "https://ossmeet.com";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OSSMeet — Free Video Meetings & Collaborative Whiteboards" },
      {
        name: "description",
        content:
          "Start or join a video meeting with a built-in collaborative whiteboard. Free, open source, no downloads required.",
      },
      { property: "og:title", content: "OSSMeet — Free Video Meetings & Collaborative Whiteboards" },
      { property: "og:description", content: "Start or join a video meeting with a built-in collaborative whiteboard. Free, open source, no downloads required." },
      { property: "og:url", content: SITE_URL },
      { name: "twitter:title", content: "OSSMeet — Free Video Meetings & Collaborative Whiteboards" },
      { name: "twitter:description", content: "Start or join a video meeting with a built-in collaborative whiteboard. Free, open source, no downloads required." },
    ],
    links: [
      { rel: "canonical", href: SITE_URL },
      {
        rel: "preload",
        href: "/fonts/inter-400.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        href: "/fonts/inter-700.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "OSSMeet",
          url: SITE_URL,
          description: "Free open-source video meetings with collaborative whiteboards.",
        }),
      },
    ],
  }),
  component: LandingPage,
});

const BrandMark = lazy(() =>
  import("@/components/brand-mark").then((m) => ({ default: m.BrandMark }))
);

function ArrowIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={props.className}>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={props.className}>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type LandingButtonProps = {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

function LandingButton({
  children,
  className = "",
  disabled,
  loading,
  ...props
}: LandingButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-xl font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {loading ? (
        <>
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

function LandingPage() {
  const sessionEnabled = useIdleEnabled();
  const { data: session, isLoading: sessionLoading } = useQuery({
    ...sessionQueryOptions(),
    enabled: sessionEnabled,
  });
  const queryClient = useQueryClient();
  const [joinCode, setJoinCode] = useState("");
  const [isCheckingSession, setIsCheckingSession] = useState(false);
  const [createErrorMessage, setCreateErrorMessage] = useState("");
  const router = useRouter();
  const handleMeetingIntent = useCallback(() => {
    preloadMeetingRoute(router).catch(() => {});
  }, [router]);

  const createMutation = useMutation({
    mutationFn: (recordingEnabled: boolean) => createMeeting({
      data: {
        allowGuests: true,
        recordingEnabled,
      },
    }),
    onMutate: () => {
      // Start downloading the meeting route chunk immediately, in parallel with
      // the createMeeting API call. By the time window.location.href fires and
      // the browser requests the new page, the chunk is already in the HTTP cache.
      beginMeetingEntryFlow({ source: "landing-create" });
      handleMeetingIntent();
    },
    onSuccess: (result) => {
      // Full page reload required: the server must set meet-route CSP
      // (connect-src includes livekit, Permissions-Policy grants camera/mic).
      // Client-side navigate() preserves the landing page's restrictive headers.
      window.location.href = `/${result.code}`;
    },
    onError: async (error) => {
      const code = (error as { code?: string; statusCode?: number }).code;
      const statusCode = (error as { code?: string; statusCode?: number }).statusCode;

      if (code === "UNAUTHORIZED" || statusCode === 401) {
        await queryClient.invalidateQueries({ queryKey: sessionQueryOptions().queryKey });
        await router.navigate({
          to: "/auth",
          search: { mode: "login" },
        });
        return;
      }

      setCreateErrorMessage(getErrorMessage(error, "Failed to create meeting. Please try again."));
    },
  });
  const createMeetingMutate = createMutation.mutate;

  const handleCreateMeeting = useCallback(async () => {
    setCreateErrorMessage("");
    setIsCheckingSession(true);

    try {
      const currentSession = await queryClient.fetchQuery({
        ...sessionQueryOptions(),
        staleTime: 0,
      });

      if (!currentSession?.user) {
        router.navigate({
          to: "/auth",
          search: { mode: "login" },
        });
        return;
      }

      createMeetingMutate(getPlanLimits(currentSession.user.plan).recordingEnabled);
    } catch (error) {
      setCreateErrorMessage(getErrorMessage(error, "Failed to create meeting. Please try again."));
    } finally {
      setIsCheckingSession(false);
    }
  }, [createMeetingMutate, queryClient, router]);

  const handleJoin = () => {
    const code = joinCode.trim().toLowerCase();
    if (!code) return;
    if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) return;
    beginMeetingEntryFlow({ source: "landing-join", code });
    window.location.href = `/${code}`;
  };

  return (
    <div className="min-h-screen bg-[#f5f4f2] relative overflow-hidden font-sans">
      {/* Subtle background blobs - positioned away from header */}
      <div className="absolute top-40 left-[10%] w-72 h-72 rounded-full bg-teal-200/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-32 right-[15%] w-64 h-64 rounded-full bg-amber-200/10 blur-3xl pointer-events-none" />

      {/* Nav */}
      <header className="relative z-50 px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent-700 flex items-center justify-center">
              <BrandMark className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-neutral-900 tracking-tight text-lg font-heading">OSSMeet</span>
          </Link>
          {!session?.user ? (
            <div className="flex items-center gap-2 sm:gap-4">
              <Link to="/status" className="text-sm font-semibold text-neutral-600 hover:text-accent-700 transition-colors">
                Status
              </Link>
              <Link to="/pricing" className="text-sm font-semibold text-neutral-600 hover:text-accent-700 transition-colors">
                Pricing
              </Link>
              <Link to="/auth" search={{ mode: "login" }} className="inline-flex items-center rounded-full bg-white px-3 sm:px-5 py-2 text-sm font-bold text-neutral-800 transition-all duration-200 hover:bg-neutral-50 hover:border-neutral-300 shadow-soft hover:shadow-card border border-transparent">
                Sign In
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2 sm:gap-4">
              <Link to="/status" className="text-sm font-semibold text-neutral-600 hover:text-accent-700 transition-colors">
                Status
              </Link>
              <Link to="/pricing" className="text-sm font-semibold text-neutral-600 hover:text-accent-700 transition-colors">
                Pricing
              </Link>
              <Link to="/dashboard" className="inline-flex items-center rounded-full bg-white px-3 sm:px-5 py-2 text-sm font-bold text-neutral-800 transition-all duration-200 hover:bg-neutral-50 hover:border-neutral-300 shadow-soft hover:shadow-card border border-transparent">
                Dashboard
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Main content — everything centered */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-12 sm:pt-20 pb-16 flex flex-col items-center">

        {/* Hero text — centered */}
        <div className="text-center max-w-2xl mx-auto">
          <h1 className="text-h1 font-bold text-neutral-900 tracking-tight leading-[1.1] font-heading">
            Meetings with a
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent-700 to-teal-500">
              shared canvas
            </span>
          </h1>
          <p className="text-neutral-600 text-lg sm:text-xl mt-5 leading-relaxed max-w-lg mx-auto">
            Real-time video, voice, and a collaborative whiteboard for educators and teams.
          </p>
        </div>

        {/* Two tiles — Start (left) and Join (right) */}
        <div className="w-full max-w-2xl mt-12 grid grid-cols-1 sm:grid-cols-2 gap-5 animate-fade-in-up" style={{animationDelay: "150ms"}}>

          {/* Start tile */}
          <div className="group bg-white border border-neutral-200/80 shadow-elevated rounded-2xl p-6 sm:p-8 flex flex-col items-center text-center gap-4 transition-all duration-300">
            <div className="w-12 h-12 rounded-xl bg-accent-700 flex items-center justify-center text-white">
              <BrandMark className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-neutral-900 font-bold text-lg font-heading">Start a Meeting</h2>
              <p className="text-neutral-500 text-sm mt-1">Create a new session and invite others</p>
            </div>
            {sessionLoading ? (
              <LandingButton
                disabled
                className="mt-auto h-12 w-full gap-2 bg-accent-700 hover:bg-accent-800 shadow-soft text-sm text-white"
              >
                <PlusIcon className="h-4 w-4" />
                New Meeting
              </LandingButton>
            ) : session?.user ? (
              <LandingButton
                onPointerEnter={handleMeetingIntent}
                onFocus={handleMeetingIntent}
                onClick={() => {
                  void handleCreateMeeting();
                }}
                loading={isCheckingSession || createMutation.isPending}
                className="mt-auto h-12 w-full gap-2 bg-accent-700 hover:bg-accent-800 shadow-soft text-sm text-white"
              >
                <PlusIcon className="h-4 w-4" />
                New Meeting
              </LandingButton>
            ) : (
              <Link to="/auth" search={{ mode: "login" }} className="w-full mt-auto">
                <span className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-accent-700 text-sm font-bold text-white transition-all hover:bg-accent-800">
                  Sign in to Start
                </span>
              </Link>
            )}
            {createErrorMessage && (
              <p className="text-red-600 text-xs font-semibold">
                {createErrorMessage}
              </p>
            )}
          </div>

          {/* Join tile */}
          <div className="group bg-white border border-neutral-200/80 shadow-elevated rounded-2xl p-6 sm:p-8 flex flex-col items-center text-center gap-4 transition-all duration-300">
            <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 shadow-soft flex items-center justify-center">
              <ArrowIcon className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-neutral-900 font-bold text-lg font-heading">Join a Meeting</h2>
              <p className="text-neutral-500 text-sm mt-1">Enter a code you received from the host</p>
            </div>
            <div className="relative flex w-full mt-auto">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                onFocus={handleMeetingIntent}
                aria-label="Meeting code"
                placeholder="xxx-xxxx-xxx"
                autoComplete="off"
                className="w-full h-12 rounded-xl border border-neutral-200 bg-white pl-4 pr-14 text-center text-sm font-medium tracking-[0.28em] text-neutral-900 placeholder:text-neutral-400 transition-all focus-visible:border-accent-400/40 focus-visible:outline-hidden"
              />
              <button
                onPointerEnter={handleMeetingIntent}
                onFocus={handleMeetingIntent}
                onClick={handleJoin}
                disabled={!joinCode.trim()}
                aria-label="Join meeting"
                className="absolute right-1 top-1 bottom-1 w-10 bg-accent-700 hover:bg-accent-800 disabled:opacity-30 text-white rounded-lg flex items-center justify-center transition-all"
              >
                <ArrowIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Trust line */}
        <div className="flex items-center gap-4 text-neutral-500 text-xs mt-8 animate-fade-in" style={{animationDelay: "300ms"}}>
          <span>Free & open source</span>
          <div className="w-1 h-1 rounded-full bg-neutral-400" />
          <span>No downloads</span>
          <div className="w-1 h-1 rounded-full bg-neutral-400" />
          <span>End-to-end secure</span>
        </div>

        <div className="flex items-center gap-4 text-neutral-400 text-xs mt-4 animate-fade-in" style={{animationDelay: "400ms"}}>
          <Link to="/terms" className="hover:text-accent-700 transition-colors">Terms</Link>
          <div className="w-1 h-1 rounded-full bg-neutral-300" />
          <Link to="/privacy" className="hover:text-accent-700 transition-colors">Privacy</Link>
        </div>

      </main>
    </div>
  );
}
