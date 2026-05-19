import * as React from "react";
import { createFileRoute, notFound, rootRouteId } from "@tanstack/react-router";
import { markMeetingEntryMetric, readCreatedMeetingLookup } from "@/lib/meeting/entry-metrics";
import { isMeetingCode } from "@/lib/meeting-path";
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

export const Route = createFileRoute("/$code")({
  params: {
    parse: ({ code }) => {
      if (!isMeetingCode(code)) {
        throw notFound({ routeId: rootRouteId });
      }
      return { code };
    },
    stringify: ({ code }) => ({ code }),
  },
  pendingMs: 0,
  pendingMinMs: 0,
  ssr: 'data-only',
  loader: async ({ context, params }) => {
    // Run the meeting lookup and session prefetch in parallel so both are in
    // the dehydrated cache by the time the client hydrates. The cached lookup
    // is only populated client-side (sessionStorage), so the server always
    // falls back to the DB call — which is fine since D1 I/O doesn't count
    // against CPU time.
    const cachedLookup = readCreatedMeetingLookup(params.code);
    const [lookup] = await Promise.all([
      cachedLookup ?? lookupMeeting({ data: { code: params.code } }),
      context.queryClient.prefetchQuery(sessionQueryOptions()),
    ]);
    if (!lookup.exists) {
      throw notFound();
    }
    return { lookup };
  },
  pendingComponent: MeetingPendingComponent,
  notFoundComponent: MeetingNotFoundComponent,
  head: () =>
    createPageHead({
      title: "Join Meeting — OSSMeet",
      description: "Join a live OSSMeet session using a meeting code.",
      noindex: true,
      canonical: false,
    }),
  // component is provided by $code.lazy.tsx
});
