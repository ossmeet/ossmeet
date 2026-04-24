import { createFileRoute } from "@tanstack/react-router";
import { mySpacesQueryOptions } from "@/queries/spaces";
import { myActiveMeetingsQueryOptions, myRecentMeetingsQueryOptions } from "@/queries/meetings";

export const Route = createFileRoute("/_authed/dashboard/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(mySpacesQueryOptions()),
      context.queryClient.ensureQueryData(myRecentMeetingsQueryOptions()),
      context.queryClient.ensureQueryData(myActiveMeetingsQueryOptions()),
    ]);
  },
});
