import { queryOptions } from "@tanstack/react-query";
import { listSessions, listPasskeys } from "@/server/auth";
import { getLinkedAccounts } from "@/server/auth/oauth-google";
import { queryKeys } from "@/lib/query-keys";

export const sessionsListQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.sessions.all(),
    queryFn: () => listSessions(),
    staleTime: 30 * 1000, // 30s — security-sensitive, keep fresh
    gcTime: 1000 * 60 * 5,
  });

export const linkedAccountsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.linkedAccounts(),
    queryFn: () => getLinkedAccounts(),
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
  });

export const passkeysQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.passkeys(),
    queryFn: () => listPasskeys(),
    staleTime: 30 * 1000,
    gcTime: 1000 * 60 * 5,
  });
