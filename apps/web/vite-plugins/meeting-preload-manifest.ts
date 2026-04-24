import type { Plugin } from "vite";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

/**
 * Generates a JSON manifest mapping the meeting lazy route to its chunk file.
 *
 * The server reads this manifest at runtime to inject `<link rel="modulepreload">`
 * tags for meeting URLs, allowing browsers to start downloading the heavy meeting
 * chunk immediately instead of waiting for: JS load -> React hydrate -> router
 * match -> dynamic import.
 *
 * Output: `dist/client/meeting-chunks.json`
 */
export function meetingPreloadManifest(): Plugin {
  return {
    name: "meeting-preload-manifest",
    apply: "build",
    writeBundle(options, bundle) {
      // Only run in the client build (not SSR)
      const outDir = options.dir;
      // SSR builds output to dist/server; client builds output to dist/client
      if (!outDir || outDir.includes("/server")) return;

      const chunks: string[] = [];

      for (const [fileName, output] of Object.entries(bundle)) {
        if (fileName.startsWith("assets/") && fileName.endsWith(".js")) {
          const chunk = output as { name?: string; dynamicImports?: string[] };
          // The meeting lazy chunk is named "_code.lazy" by the manualChunks config
          if (chunk.name === "_code.lazy") {
            chunks.push("/" + fileName);
          }
        }
      }

      if (chunks.length === 0) return;

      const manifest = { meetingChunks: chunks };
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(
        outDir + "/meeting-chunks.json",
        JSON.stringify(manifest),
      );
    },
  };
}
