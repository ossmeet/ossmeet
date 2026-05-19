import { queryOptions } from "@tanstack/react-query";
import { getMySpaces, getSpace } from "@/server/spaces/crud";
import { queryKeys } from "@/lib/query-keys";

export const mySpacesQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.spaces.all(),
    queryFn: () => getMySpaces(),
    staleTime: 30 * 1000, // 30 seconds - user's spaces list doesn't change often
    gcTime: 1000 * 60 * 5, // 5 minutes
  });

export const spaceQueryOptions = (spaceId: string) =>
  queryOptions({
    queryKey: queryKeys.spaces.detail(spaceId),
    queryFn: () => getSpace({ data: { spaceId } }),
    staleTime: 60 * 1000, // 1 minute - space details are relatively stable
    gcTime: 1000 * 60 * 5, // 5 minutes
  });
