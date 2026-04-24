import { queryOptions } from "@tanstack/react-query";
import { getMyRecentMeetings } from "@/server/meetings/crud";
import { getMyActiveMeetings, getMyMeetingLinks } from "@/server/meetings/dashboard";
import { queryKeys } from "@/lib/query-keys";

export function myRecentMeetingsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.rooms.recent(),
    queryFn: () => getMyRecentMeetings(),
    staleTime: 30_000,
    gcTime: 300_000,
  });
}

export function myActiveMeetingsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.rooms.active(),
    queryFn: () => getMyActiveMeetings(),
    staleTime: 10_000,
    gcTime: 60_000,
  });
}

export function myMeetingLinksQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.rooms.links(),
    queryFn: () => getMyMeetingLinks(),
    staleTime: 60_000,
    gcTime: 300_000,
  });
}
