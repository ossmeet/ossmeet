import { createFileRoute } from "@tanstack/react-router";
import { getDashboardData } from "@/server/dashboard";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_authed/dashboard/")({
  loader: async ({ context }) => {
    const data = await getDashboardData();
    context.queryClient.setQueryData(queryKeys.spaces.all(), data.spaces);
    context.queryClient.setQueryData(queryKeys.rooms.active(), data.activeMeetings);
    context.queryClient.setQueryData(queryKeys.rooms.links(), data.meetingLinks);
    context.queryClient.setQueryData(queryKeys.rooms.recent(), data.recentMeetings);
  },
});
