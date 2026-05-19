import { queryOptions } from "@tanstack/react-query";
import { listSpaceAssets } from "@/server/assets";
import { queryKeys } from "@/lib/query-keys";

export const spaceAssetsQueryOptions = (spaceId: string) =>
  queryOptions({
    queryKey: queryKeys.assets.bySpace(spaceId),
    queryFn: () => listSpaceAssets({ data: { spaceId } }),
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
  });
