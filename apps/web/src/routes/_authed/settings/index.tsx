import { createFileRoute } from "@tanstack/react-router";
import { sessionsListQueryOptions, linkedAccountsQueryOptions } from "@/queries/settings";

export const Route = createFileRoute("/_authed/settings/")({
  validateSearch: (raw): { linked?: string; reason?: string } => ({
    linked: typeof raw?.linked === "string" ? raw.linked : undefined,
    reason: typeof raw?.reason === "string" ? raw.reason : undefined,
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.prefetchQuery(sessionsListQueryOptions()),
      context.queryClient.prefetchQuery(linkedAccountsQueryOptions()),
    ]),
});
