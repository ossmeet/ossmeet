import { queryOptions } from "@tanstack/react-query";
import { getRoomLatestSummary, getRoomLatestTranscripts } from "@/server/transcripts/room-recap";
import { queryKeys } from "@/lib/query-keys";

export function meetingSummaryQueryOptions(code: string) {
  return queryOptions({
    queryKey: queryKeys.rooms.summary(code),
    queryFn: () => getRoomLatestSummary({ data: { code } }),
    staleTime: 300_000,
    gcTime: 600_000,
  });
}

export function meetingTranscriptsQueryOptions(code: string) {
  return queryOptions({
    queryKey: queryKeys.rooms.transcripts(code),
    queryFn: () => getRoomLatestTranscripts({ data: { code } }),
    staleTime: 300_000,
    gcTime: 600_000,
  });
}
