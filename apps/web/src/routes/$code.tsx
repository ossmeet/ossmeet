import * as React from "react";
import { createFileRoute, notFound, rootRouteId } from "@tanstack/react-router";
import { markMeetingEntryMetric } from "@/lib/meeting/entry-metrics";
import { preloadMeetingWhiteboardModule } from "@/lib/meeting/preload-whiteboard";
import { sessionQueryOptions } from "@/queries/session";
import { lookupMeeting } from "@/server/meetings/admission";
import { createPageHead } from "@/lib/seo";

function MeetingNotFoundComponent() {
  return (
    <div className="relative flex h-dvh items-center justify-center overflow-hidden bg-canvas">
      <div className="pointer-events-none absolute top-1/2 left-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(244,63,94,0.05)_0%,transparent_70%)] blur-[80px]" />
      <div className="relative max-w-md text-center rounded-[20px] border border-stone-200/80 bg-white/90 px-10 py-9 shadow-elevated backdrop-blur-xl">
        <h1 className="m-0 text-[20px] font-semibold tracking-[-0.01em] text-stone-800">
          No meeting found
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-stone-500">
          The code you entered doesn't match any active meeting. Double-check the
          link, or ask the host to share a fresh one.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          Return home
        </a>
      </div>
    </div>
  );
}

function MeetingPendingComponent() {
  React.useEffect(() => {
    markMeetingEntryMetric("routeMountedAt");
    preloadMeetingWhiteboardModule().catch(() => {});
  }, []);

  return (
    <div className="relative flex h-dvh items-center justify-center overflow-hidden bg-canvas">
      {/* Subtle warm gradient blob */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(20,184,166,0.06)_0%,transparent_70%)] blur-[80px]" />

      {/* Clean card */}
      <div className="relative text-center rounded-[20px] border border-stone-200/80 bg-white/90 px-12 py-9 shadow-elevated backdrop-blur-xl">
        {/* Teal gradient spinner container */}
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-50 to-teal-100 shadow-[0_4px_12px_-2px_rgba(20,184,166,0.15)]">
          <div className="h-6 w-6 rounded-full border-2 border-teal-500/20 border-t-teal-600/90 animate-spin" />
        </div>
        <p className="m-0 text-[15px] font-medium tracking-[0.01em] text-stone-500">
          Loading meeting...
        </p>
        {/* Bouncing dots */}
        <div className="mt-3 flex justify-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-500/60 animate-bounce-dot" />
          <span className="h-1.5 w-1.5 rounded-full bg-teal-500/60 animate-bounce-dot [animation-delay:0.15s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-teal-500/60 animate-bounce-dot [animation-delay:0.3s]" />
        </div>
      </div>
    </div>
  );
}

const MEETING_CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export const Route = createFileRoute("/$code")({
  params: {
    parse: ({ code }) => {
      if (!MEETING_CODE_RE.test(code)) {
        throw notFound({ routeId: rootRouteId });
      }
      return { code };
    },
    stringify: ({ code }) => ({ code }),
  },
  pendingMs: 0,
  pendingMinMs: 0,
  head: () =>
    createPageHead({
      title: "Join Meeting — OSSMeet",
      description: "Join a live OSSMeet session using a meeting code.",
      noindex: true,
      canonical: false,
    }),
  ssr: false,
  pendingComponent: MeetingPendingComponent,
  notFoundComponent: MeetingNotFoundComponent,
  loader: async ({ context, params }) => {
    // Kick off session fetch immediately so sessionData is in the cache by the
    // time the lazy component mounts. Non-blocking.
    context.queryClient.prefetchQuery(sessionQueryOptions());

    // Blocking pre-flight: verify the meeting actually exists BEFORE the lazy
    // component mounts and spins up the preview UI. Saves the "preview then
    // 'no such meeting'" dance for typos and random valid-format codes.
    const lookup = await lookupMeeting({ data: { code: params.code } });
    if (!lookup.exists) {
      throw notFound();
    }
    return { lookup };
  },
  // component is provided by $code.lazy.tsx
});
