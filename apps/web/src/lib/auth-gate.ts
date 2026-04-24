import { redirect, isRedirect } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/queries/session";
import type { QueryClient } from "@tanstack/react-query";

interface SessionGateContext {
  queryClient: QueryClient;
}

interface SessionGateLocation {
  pathname: string;
  searchStr: string;
}

/**
 * Shared auth gate utility for protected routes.
 * Fetches session from server and redirects to login if unauthenticated.
 * Falls back to cached session on transient network errors.
 */
export async function resolveSessionGate(
  context: SessionGateContext,
  location: SessionGateLocation
) {
  // Use the raw searchStr from TanStack Router's ParsedLocation to preserve
  // structured/nested search params exactly, instead of re-serializing the
  // parsed object (which would corrupt values like arrays or nested objects).
  const buildRedirectUrl = () =>
    location.searchStr ? `${location.pathname}${location.searchStr}` : location.pathname;

  try {
    // Use fetchQuery instead of ensureQueryData because ensureQueryData
    // returns cached data (even null) without refetching when stale.
    // This caused logged-in users to be redirected to /auth after login
    // because the pre-login null session was returned from cache.
    // fetchQuery respects staleness and isInvalidated, so after
    // invalidateQueries it will re-fetch from the server.
    const session = await context.queryClient.fetchQuery(sessionQueryOptions());
    if (!session) {
      throw redirect({
        to: "/auth",
        search: { mode: "login", redirect: buildRedirectUrl() },
      });
    }
    return { session };
  } catch (error) {
    if (isRedirect(error)) throw error;
    // Only redirect to login if session query resolved to null (user not authenticated).
    // Don't redirect on transient network/server errors — those would incorrectly log users out.
    const cached = context.queryClient.getQueryData(
      sessionQueryOptions().queryKey
    );

    // If we have a valid (truthy) cached session, use it even if the refetch failed.
    // This prevents transient network errors from logging users out.
    if (cached) {
      return { session: cached };
    }

    // No valid cached session — redirect to login
    throw redirect({
      to: "/auth",
      search: { mode: "login", redirect: buildRedirectUrl() },
    });
  }
}
