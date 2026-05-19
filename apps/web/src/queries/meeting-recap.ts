import { queryOptions } from "@tanstack/react-query";
import { getRoomLatestSummary, getRoomLatestTranscripts } from "@/server/transcripts/room-recap";
import {
  ensurePostMeetingSummaryForParticipant,
  getPostMeetingSummaryForParticipant,
} from "@/server/transcripts/post-meeting-summary";
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

export function publicRecapQueryOptions(code: string, meetingId: string, admissionId: string) {
  return queryOptions({
    queryKey: queryKeys.publicRecap(code, meetingId, admissionId),
    queryFn: () =>
      getPostMeetingSummaryForParticipant({ data: { meetingId, admissionId } }),
    staleTime: 0,
    gcTime: 300_000,
    retry: false,
  });
}

export function ensurePublicRecapQueryOptions(meetingId: string, admissionId: string) {
  return {
    mutationFn: () =>
      ensurePostMeetingSummaryForParticipant({ data: { meetingId, admissionId } }),
  };
}
