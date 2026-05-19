import { createFileRoute, notFound } from "@tanstack/react-router";
import { isMeetingCode } from "@/lib/meeting-path";
import { meetingSummaryQueryOptions } from "@/queries/meeting-recap";

export const Route = createFileRoute("/_authed/dashboard/$code")({
  params: {
    parse: ({ code }) => {
      if (!isMeetingCode(code)) throw notFound();
      return { code };
    },
    stringify: ({ code }) => ({ code }),
  },
  loader: async ({ context, params }) => {
    await context.queryClient.prefetchQuery(meetingSummaryQueryOptions(params.code));
  },
});
