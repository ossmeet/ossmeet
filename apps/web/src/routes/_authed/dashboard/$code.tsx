import { createFileRoute, notFound } from "@tanstack/react-router";
import { meetingSummaryQueryOptions } from "@/queries/meeting-recap";

const ROOM_CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export const Route = createFileRoute("/_authed/dashboard/$code")({
  params: {
    parse: ({ code }) => {
      if (!ROOM_CODE_RE.test(code)) throw notFound();
      return { code };
    },
    stringify: ({ code }) => ({ code }),
  },
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(meetingSummaryQueryOptions(params.code));
  },
});
