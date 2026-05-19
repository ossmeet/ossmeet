import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { ssrClientStubs } from "./vite-plugins/ssr-client-stubs";
import { meetingPreloadManifest } from "./vite-plugins/meeting-preload-manifest";
import { ssrViteIgnoreResolver } from "./vite-plugins/ssr-vite-ignore-resolver";
import { visualizer } from "rollup-plugin-visualizer";
import type { Plugin } from "vite";

function stripDevVarsArtifacts(): Plugin {
  const collectMatches = (dir: string): string[] => {
    if (!existsSync(dir)) return [];

    const matches: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        matches.push(...collectMatches(fullPath));
        continue;
      }
      if (entry.name.startsWith(".dev.vars")) {
        matches.push(fullPath);
      }
    }
    return matches;
  };

  return {
    name: "strip-dev-vars-artifacts",
    apply: "build",
    closeBundle() {
      const distDir = fileURLToPath(new URL("./dist", import.meta.url));
      const matches = collectMatches(distDir);
      for (const match of matches) {
        rmSync(match, { force: true });
      }

      const remaining = collectMatches(distDir);
      if (remaining.length > 0) {
        throw new Error(`Build output contains forbidden .dev.vars artifacts: ${remaining.join(", ")}`);
      }
    },
  };
}

const enableCloudflareInspector = process.env.CLOUDFLARE_INSPECTOR === "true";

let _wranglerVars: Record<string, string> | null = null;

function stripJsonComments(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const next = value[i + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < value.length && value[i] !== "\n") i += 1;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < value.length && !(value[i] === "*" && value[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function getWranglerVars(): Record<string, string> {
  if (_wranglerVars !== null) return _wranglerVars;
  try {
    const raw = readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8");
    const stripped = stripJsonComments(raw).replace(/,(\s*[}\]])/g, "$1");
    const parsed = JSON.parse(stripped) as { vars?: Record<string, unknown> };
    _wranglerVars = Object.fromEntries(
      Object.entries(parsed?.vars ?? {}).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
  } catch {
    _wranglerVars = {};
  }
  return _wranglerVars;
}

function readWranglerVar(name: string): string | undefined {
  return getWranglerVars()[name];
}

const clientLiveKitUrl =
  process.env.VITE_LIVEKIT_URL ??
  process.env.LIVEKIT_URL ??
  readWranglerVar("VITE_LIVEKIT_URL") ??
  readWranglerVar("LIVEKIT_URL") ??
  "";

const clientWhiteboardUrl =
  process.env.VITE_WHITEBOARD_URL ??
  process.env.WHITEBOARD_URL ??
  readWranglerVar("VITE_WHITEBOARD_URL") ??
  readWranglerVar("WHITEBOARD_URL") ??
  "";

const paddleClientToken =
  process.env.VITE_PADDLE_CLIENT_TOKEN ??
  readWranglerVar("VITE_PADDLE_CLIENT_TOKEN") ??
  "";

const paddleEnvironment =
  process.env.PADDLE_ENVIRONMENT ??
  readWranglerVar("PADDLE_ENVIRONMENT") ??
  "production";

const tldrawLicenseKey =
  process.env.VITE_TLDRAW_LICENSE_KEY ??
  readWranglerVar("VITE_TLDRAW_LICENSE_KEY") ??
  "";

export default defineConfig(async () => {
  const wb = await import(
    pathToFileURL(
      fileURLToPath(new URL("../../packages/whiteboard/src/build-profile.mjs", import.meta.url))
    ).href
  );

  return {
    define: {
      "import.meta.env.VITE_LIVEKIT_URL": JSON.stringify(clientLiveKitUrl),
      "import.meta.env.VITE_WHITEBOARD_URL": JSON.stringify(clientWhiteboardUrl),
      __OSSMEET_LIVEKIT_URL__: JSON.stringify(clientLiveKitUrl),
      __OSSMEET_WHITEBOARD_URL__: JSON.stringify(clientWhiteboardUrl),
      "import.meta.env.VITE_PADDLE_CLIENT_TOKEN": JSON.stringify(paddleClientToken),
      "import.meta.env.PADDLE_ENVIRONMENT": JSON.stringify(paddleEnvironment),
      "import.meta.env.VITE_TLDRAW_LICENSE_KEY": JSON.stringify(tldrawLicenseKey),
    },
    resolve: {
      tsconfigPaths: true,
      alias: [
        { find: "@whiteboard/runtime",    replacement: wb.webRuntimeModule },
        { find: "@whiteboard/api",        replacement: wb.webApiModule },
        { find: "@whiteboard/dashboard",  replacement: wb.webDashboardModule },
        { find: "@whiteboard/recorder",   replacement: wb.webRecorderModule },
        { find: "@whiteboard/styles.css", replacement: wb.webStylesModule },
        { find: "@whiteboard/server",     replacement: wb.webServerModule },
        ...wb.resolveAliases,
      ],
    },
    plugins: [
      stripDevVarsArtifacts(),
      ssrViteIgnoreResolver(),
      ssrClientStubs({ additional: wb.additionalSsrStubs }),
      meetingPreloadManifest(),
      tanstackStart({
        importProtection: {
          client: {
            specifiers: ["livekit-server-sdk"],
          },
        },
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
      cloudflare({
        viteEnvironment: { name: "ssr" },
        inspectorPort: enableCloudflareInspector ? undefined : false,
      }),
      tailwindcss(),
      viteReact(),
      process.env.ANALYZE === "true" &&
        visualizer({ open: true, filename: "dist/stats.html", gzipSize: true, brotliSize: true }),
    ],

    build: {
      emptyOutDir: true,
      target: ["chrome120", "safari16", "ios16", "firefox115"],
      rolldownOptions: {
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

            const wbChunk = wb.classifyChunk(id);
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

            if (wb.isWhiteboardVendor(id))
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
