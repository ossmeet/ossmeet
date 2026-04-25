import { createFileRoute, notFound } from "@tanstack/react-router";
import { spaceQueryOptions } from "@/queries/spaces";
import { spaceAssetsQueryOptions } from "@/queries/assets";

export const Route = createFileRoute("/_authed/spaces/$spaceId")({
  params: {
    parse: ({ spaceId }) => {
      if (!spaceId.startsWith("spc_")) {
        throw notFound();
      }
      return { spaceId };
    },
    stringify: ({ spaceId }) => ({ spaceId }),
  },
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.prefetchQuery(spaceQueryOptions(params.spaceId)),
      context.queryClient.prefetchQuery(spaceAssetsQueryOptions(params.spaceId)),
    ]);
  },
});
