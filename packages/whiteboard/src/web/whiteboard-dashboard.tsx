import * as React from "react";
import type { getRoomLatestSummary } from "@/server/transcripts/room-recap";

type MeetingRecapSession = NonNullable<
  Awaited<ReturnType<typeof getRoomLatestSummary>>["session"]
>;

const LazyMeetingRecapPdfPanel = React.lazy(async () => {
  const module = await import("./dashboard/meeting-recap-pdf-panel");
  return { default: module.MeetingRecapPdfPanel };
});

export function MeetingRecapPdfPanel(props: {
  session: MeetingRecapSession;
  code: string;
}) {
  return (
    <React.Suspense fallback={null}>
      <LazyMeetingRecapPdfPanel {...props} />
    </React.Suspense>
  );
}

export {
  RecentMeetingsPdfCell,
} from "./dashboard/recent-meetings-pdf";
