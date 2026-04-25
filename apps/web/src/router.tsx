import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

// Per-request router instantiation for SSR isolation on Cloudflare Workers.
// Each request creates a new QueryClient and Router to prevent cross-request
// data leaks. The setupRouterSsrQueryIntegration handles hydration transfer.
export const getRouter = () => {
  const isDev = import.meta.env.DEV;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5-minute freshness window
        gcTime: 1000 * 60 * 10, // 10-minute garbage collection window
        retry: (failureCount, error) => {
          // No retries during SSR to keep server rendering fast
          if (typeof window === "undefined") return false;
          // Don't retry errors that will always fail
          const code = (error as { code?: string })?.code;
          if (code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "VALIDATION_ERROR" || code === "NOT_FOUND") {
            return false;
          }
          return failureCount < 2;
        },
      },
    },
  });

  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    // In dev, link-hover preloading makes Vite eagerly transform lazy route
    // graphs on every hover/focus and can make localhost feel randomly slow.
    // Keep the production optimization, but make development deterministic.
    defaultPreload: isDev ? false : "intent",
    // When TanStack Query owns caching, Router preloads should always re-run
    // loaders and let Query decide whether the cached result is still fresh.
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 150,
    defaultPendingMinMs: 100,
    defaultPendingComponent: () => (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
      </div>
    ),
    context: { queryClient },
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
};
