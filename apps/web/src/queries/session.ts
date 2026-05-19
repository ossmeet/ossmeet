import { queryOptions } from "@tanstack/react-query";
import { getServerErrorCode } from "@/lib/errors";
import { getRememberedUser, getSession } from "@/server/auth/login";
import { queryKeys } from "@/lib/query-keys";

export const sessionQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.session(),
    queryFn: () => getSession(),
    staleTime: 1000 * 60 * 2, // 2 min - reduced from 10 to catch session expirations faster — session rarely changes, avoid refetching on every navigation
    gcTime: 1000 * 60 * 30, // 30 min — keep session in cache longer to survive transient errors
    retry: (failureCount, error) => {
      // Don't retry on auth errors - they'll never succeed
      const code = getServerErrorCode(error);
      if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return false;
      return failureCount < 2;
    },
  });

export const rememberedUserQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.rememberedUser(),
    queryFn: () => getRememberedUser(),
    staleTime: 1000 * 60 * 5,
  });
