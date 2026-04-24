import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { ssrClientStubs, type AdditionalSsrStubs } from "./vite-plugins/ssr-client-stubs";
import { meetingPreloadManifest } from "./vite-plugins/meeting-preload-manifest";
import { ssrViteIgnoreResolver } from "./vite-plugins/ssr-vite-ignore-resolver";
import { visualizer } from "rollup-plugin-visualizer";
import type { Plugin } from "vite";

const WHITEBOARD_AVAILABLE = existsSync(new URL("../../packages/whiteboard/package.json", import.meta.url));

type WhiteboardPlugin = () => Plugin;
type IsWhiteboardVendor = (id: string) => boolean;
type ClassifyChunk = (id: string) => string | undefined;
type ResolveAlias = { find: string | RegExp; replacement: string };

interface WhiteboardPluginExports {
  whiteboardPlugin: WhiteboardPlugin;
  isWhiteboardVendor: IsWhiteboardVendor;
  classifyChunk: ClassifyChunk;
  additionalSsrStubs: AdditionalSsrStubs;
  resolveAliases: ResolveAlias[];
}

async function loadWhiteboardPlugin(): Promise<WhiteboardPluginExports> {
  if (!WHITEBOARD_AVAILABLE) {
    return {
      whiteboardPlugin: () => ({ name: "whiteboard-disabled" }),
      isWhiteboardVendor: () => false,
      classifyChunk: () => undefined,
      additionalSsrStubs: { modules: [], exports: {} },
      resolveAliases: [],
    };
  }
  const whiteboardPluginModule = fileURLToPath(
    new URL("../../packages/whiteboard/src/vite-plugin.mjs", import.meta.url)
  );
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — private package, no declaration file in public builds
  const wb = await import(/* @vite-ignore */ whiteboardPluginModule);
  return {
    whiteboardPlugin: wb.whiteboardPlugin,
    isWhiteboardVendor: wb.isWhiteboardVendor,
    classifyChunk: wb.classifyChunk ?? (() => undefined),
    additionalSsrStubs: wb.additionalSsrStubs ?? { modules: [], exports: {} },
    resolveAliases: wb.resolveAliases ?? [],
  };
}

/**
 * Wrap whiteboardPlugin so its buildEnd hook only runs in client builds.
 * SSR stubs replace client-only libs, so the plugin's post-build checks
 * would fail spuriously in the SSR environment.
 */
function clientOnlyWhiteboardPlugin(whiteboardPlugin: WhiteboardPlugin): Plugin {
  const plugin = whiteboardPlugin() as Plugin & { buildEnd?: (this: any) => void };
  const buildEnd = plugin.buildEnd;
  if (buildEnd) {
    plugin.buildEnd = function (this: any) {
      if (this?.environment?.name === "ssr") return;
      return buildEnd.call(this);
    };
  }
  return plugin;
}

const enableCloudflareInspector = process.env.CLOUDFLARE_INSPECTOR === "true";

function readWranglerVar(name: string): string | undefined {
  try {
    const config = readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8");
    const match = config.match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`));
    return match?.[1];
  } catch {
    return undefined;
  }
}

const clientLiveKitUrl =
  process.env.VITE_LIVEKIT_URL ??
  process.env.LIVEKIT_URL ??
  readWranglerVar("VITE_LIVEKIT_URL") ??
  readWranglerVar("LIVEKIT_URL") ??
  "";

const paddleClientToken =
  process.env.VITE_PADDLE_CLIENT_TOKEN ??
  readWranglerVar("VITE_PADDLE_CLIENT_TOKEN") ??
  "";

const paddleEnvironment =
  process.env.PADDLE_ENVIRONMENT ??
  readWranglerVar("PADDLE_ENVIRONMENT") ??
  "production";

export default defineConfig(async () => {
  const { whiteboardPlugin, isWhiteboardVendor, classifyChunk, additionalSsrStubs, resolveAliases } = await loadWhiteboardPlugin();
  return {
  define: {
    "import.meta.env.VITE_LIVEKIT_URL": JSON.stringify(clientLiveKitUrl),
    "import.meta.env.VITE_PADDLE_CLIENT_TOKEN": JSON.stringify(paddleClientToken),
    "import.meta.env.PADDLE_ENVIRONMENT": JSON.stringify(paddleEnvironment),
  },
  resolve: {
    tsconfigPaths: true,
    alias: resolveAliases,
  },
  plugins: [
    ssrViteIgnoreResolver(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      inspectorPort: enableCloudflareInspector ? undefined : false,
    }),
    ssrClientStubs({ additional: additionalSsrStubs }),
    meetingPreloadManifest(),
    tailwindcss(),
    clientOnlyWhiteboardPlugin(whiteboardPlugin),
    tanstackStart({
      spa: {
        enabled: true,
        maskPath: "/__spa",
      },
      sitemap: {
        enabled: true,
        host: "https://ossmeet.com",
      },
      pages: [{ path: "/refund" }],
      prerender: {
        enabled: true,
        crawlLinks: true,
        concurrency: 10,
        failOnError: false,
        filter: ({ path }) => {
          if (path.startsWith("/api")) return false;
          if (path.startsWith("/_server")) return false;
          if (path.startsWith("/dashboard")) return false;
          if (path.startsWith("/spaces")) return false;
          if (path.startsWith("/settings")) return false;
          if (path.startsWith("/meet")) return false;
          if (path.startsWith("/recorder")) return false;
          if (path.includes("?")) return false;
          return true;
        },
        retryCount: 2,
        retryDelay: 1000,
      },
    }),
    viteReact(),
    process.env.ANALYZE === "true" &&
      visualizer({ open: true, filename: "dist/stats.html", gzipSize: true, brotliSize: true }),
  ],

  build: {
    emptyOutDir: true,
    target: ["chrome120", "safari16", "ios16", "firefox115"],
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;

          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          )
            return "vendor-react";

          if (
            id.includes("/node_modules/@tanstack/") ||
            id.includes("/node_modules/seroval") ||
            id.includes("/node_modules/cookie-es/") ||
            id.includes("/node_modules/tiny-invariant/") ||
            id.includes("/node_modules/use-sync-external-store/")
          )
            return "vendor-tanstack";

          // Delegate vendor classification to the private plugin.
          // When whiteboard is absent, classifyChunk returns undefined
          // for everything.
          const wbChunk = classifyChunk(id);
          if (wbChunk) return wbChunk;

          // Do NOT manually chunk livekit packages. All livekit imports live
          // inside the lazy `$code.lazy.tsx` module graph. Letting rolldown
          // place these modules naturally keeps them in the lazy chunk graph.
          if (
            id.includes("/node_modules/livekit-") ||
            id.includes("/node_modules/@livekit/")
          )
            return;

          if (id.includes("/node_modules/@bufbuild/"))
            return "vendor-livekit-protobuf";

          if (
            id.includes("/node_modules/@base-ui/") ||
            id.includes("/node_modules/@floating-ui/") ||
            id.includes("/node_modules/tabbable/") ||
            id.includes("/node_modules/react-remove-scroll")
          )
            return "vendor-base-ui";

          if (isWhiteboardVendor(id))
            return "vendor-whiteboard-core";

          if (id.includes("/node_modules/lucide-react/"))
            return "vendor-lucide";

          if (id.includes("/node_modules/zod/")) return "vendor-zod";

          if (
            id.includes("/node_modules/tailwind-merge") ||
            id.includes("/node_modules/clsx") ||
            id.includes("/node_modules/class-variance-authority")
          )
            return "vendor-shared";

          return undefined;
        },
      },
    },
  },
  };
});
