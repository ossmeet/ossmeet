import {
  createRootRouteWithContext,
  Outlet,
  HeadContent,
  Link,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import "@/styles.css";
import { lazy, Suspense } from "react";

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({
        default: m.ReactQueryDevtools,
      }))
    )
  : null;

const TanStackRouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      }))
    )
  : null;

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "OSSMeet — Meetings & Whiteboards" },
      {
        name: "description",
        content:
          "Video meetings and collaborative whiteboards for educators, businesses, and schools.",
      },
      { name: "theme-color", content: "#4f46e5" },
      { property: "og:site_name", content: "OSSMeet" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg" },
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: NotFoundPage,
  errorComponent: RootErrorComponent,
});

function RootErrorComponent({ error: _error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-red-600">
          Something went wrong
        </h1>
        <p className="mt-2 text-neutral-600">
          An unexpected error occurred. Please try again.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              reset();
              router.invalidate();
            }}
            className="text-blue-600 hover:underline"
          >
            Retry
          </button>
          <Link to="/" className="text-blue-600 hover:underline">
            Go back home
          </Link>
        </div>
      </div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold text-neutral-900">404</h1>
      <p className="text-neutral-500">Page not found</p>
      <Link to="/" className="text-sm font-medium text-accent-700 hover:text-accent-800">
        Go home
      </Link>
    </div>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="min-h-full" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-full bg-neutral-50 text-neutral-900 antialiased isolate" suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-3xl border border-neutral-200/80 bg-white/90 px-8 py-7 text-center shadow-elevated backdrop-blur-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-700 text-white">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-neutral-900">Loading OSSMeet</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Fetching the next screen and its assets.
          </p>
        </div>
      </div>
    </div>
  );
}

function RootComponent() {
  return (
    <>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Outlet />
      </Suspense>
      {ReactQueryDevtools && (
        <Suspense fallback={null}>
          <ReactQueryDevtools buttonPosition="bottom-left" />
        </Suspense>
      )}
      {TanStackRouterDevtools && (
        <Suspense fallback={null}>
          <TanStackRouterDevtools position="bottom-right" />
        </Suspense>
      )}
    </>
  );
}
