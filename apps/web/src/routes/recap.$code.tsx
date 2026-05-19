import { createFileRoute, notFound, rootRouteId } from "@tanstack/react-router";
import { isMeetingCode } from "@/lib/meeting-path";
import { createPageHead } from "@/lib/seo";

export const Route = createFileRoute("/recap/$code")({
  params: {
    parse: ({ code }) => {
      if (!isMeetingCode(code)) {
        throw notFound({ routeId: rootRouteId });
      }
      return { code };
    },
    stringify: ({ code }) => ({ code }),
  },
  validateSearch: (raw): { meetingId?: string; admissionId?: string } => ({
    meetingId: typeof raw?.meetingId === "string" ? raw.meetingId : undefined,
    admissionId: typeof raw?.admissionId === "string" ? raw.admissionId : undefined,
  }),
  head: () =>
    createPageHead({
      title: "Meeting Recap — OSSMeet",
      description: "View the recap for a finished OSSMeet session.",
      noindex: true,
      canonical: false,
    }),
  ssr: false,
});
