import { createFileRoute } from "@tanstack/react-router";
import { mySpacesQueryOptions } from "@/queries/spaces";

export const Route = createFileRoute("/_authed/spaces/")({
  loader: ({ context }) =>
    context.queryClient.prefetchQuery(mySpacesQueryOptions()),
});
