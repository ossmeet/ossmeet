import { createFileRoute } from "@tanstack/react-router";
import { createPageHead } from "@/lib/seo";

export const Route = createFileRoute("/recorder")({
  validateSearch: (raw): { url?: string; token?: string; wb_url?: string; wb_token?: string; meeting_code?: string; layout?: string } => ({
    url: typeof raw?.url === "string" ? raw.url : "",
    token: typeof raw?.token === "string" ? raw.token : "",
    wb_url: typeof raw?.wb_url === "string" ? raw.wb_url : "",
    wb_token: typeof raw?.wb_token === "string" ? raw.wb_token : "",
    meeting_code: typeof raw?.meeting_code === "string" ? raw.meeting_code : "",
    layout: typeof raw?.layout === "string" ? raw.layout : "",
  }),
  head: () =>
    createPageHead({
      title: "Recorder — OSSMeet",
      description: "Internal recording surface for OSSMeet meeting sessions.",
      noindex: true,
      canonical: false,
    }),
  ssr: false,
});
