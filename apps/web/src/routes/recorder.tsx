import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/recorder")({
  validateSearch: (raw): { url?: string; token?: string; wb_url?: string; layout?: string } => ({
    url: typeof raw?.url === "string" ? raw.url : "",
    token: typeof raw?.token === "string" ? raw.token : "",
    wb_url: typeof raw?.wb_url === "string" ? raw.wb_url : "",
    layout: typeof raw?.layout === "string" ? raw.layout : "",
  }),
  ssr: false,
});
