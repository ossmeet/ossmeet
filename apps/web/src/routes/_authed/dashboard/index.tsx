import { createFileRoute } from "@tanstack/react-router";
import { mySpacesQueryOptions } from "@/queries/spaces";
import { myActiveMeetingsQueryOptions, myMeetingLinksQueryOptions, myRecentMeetingsQueryOptions } from "@/queries/meetings";

export const Route = createFileRoute("/_authed/dashboard/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.prefetchQuery(mySpacesQueryOptions()),
      context.queryClient.prefetchQuery(myRecentMeetingsQueryOptions()),
      context.queryClient.prefetchQuery(myActiveMeetingsQueryOptions()),
      context.queryClient.prefetchQuery(myMeetingLinksQueryOptions()),
    ]);
  },
});
