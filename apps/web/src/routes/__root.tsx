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
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  createJsonLdScript,
  buildSiteGraph,
} from "@/lib/seo";

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
      { title: `${SITE_NAME} — Meetings & Whiteboards` },
      {
        name: "description",
        content: SITE_DESCRIPTION,
      },
      { name: "application-name", content: SITE_NAME },
      { name: "apple-mobile-web-app-title", content: SITE_NAME },
      { name: "theme-color", content: "#0f766e" },
      { name: "referrer", content: "strict-origin-when-cross-origin" },
      {
        name: "robots",
        content: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
      },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "en_US" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg" },
      { rel: "manifest", href: "/manifest.json" },
      {
        rel: "alternate",
        type: "text/plain",
        title: "LLMs",
        href: `${SITE_URL}/llms.txt`,
      },
      {
        rel: "alternate",
        type: "application/json",
        title: "AI Discovery",
        href: `${SITE_URL}/api/llms.json`,
      },
    ],
    scripts: [createJsonLdScript(buildSiteGraph())],
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
        {import.meta.env.DEV ? (
          <script
            type="module"
            dangerouslySetInnerHTML={{
              __html: `
                import RefreshRuntime from "/@react-refresh";
                RefreshRuntime.injectIntoGlobalHook(window);
                window.$RefreshReg$ = () => {};
                window.$RefreshSig$ = () => (type) => type;
                window.__vite_plugin_react_preamble_installed__ = true;
              `,
            }}
          />
        ) : null}
        <HeadContent />
      </head>
      <body className="min-h-full bg-neutral-50 text-neutral-900 antialiased isolate" suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <>
      <Outlet />
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
