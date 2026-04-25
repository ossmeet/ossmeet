import type { Plugin } from "vite";

const MEETING_ROUTE_SUFFIX = "/src/routes/$code.lazy.tsx";

interface OutputChunkLike {
  fileName: string;
  name?: string;
  imports?: string[];
  dynamicImports?: string[];
  facadeModuleId?: string | null;
  moduleIds?: string[];
}

function isMeetingRouteChunk(chunk: OutputChunkLike): boolean {
  if (chunk.facadeModuleId?.endsWith(MEETING_ROUTE_SUFFIX)) return true;
  if (chunk.moduleIds?.some((id) => id.endsWith(MEETING_ROUTE_SUFFIX))) return true;
  return chunk.name?.startsWith("_code.lazy") ?? false;
}

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
    generateBundle(_options, bundle) {
      if (this.environment?.config?.consumer === "server") return;

      const chunkEntries = Object.values(bundle)
        .filter((output): output is typeof output & OutputChunkLike => output.type === "chunk");

      const chunkMap = new Map(chunkEntries.map((chunk) => [chunk.fileName, chunk]));
      const queue = chunkEntries
        .filter((chunk) => chunk.fileName.startsWith("assets/") && chunk.fileName.endsWith(".js"))
        .filter(isMeetingRouteChunk);

      const chunkFiles = new Set<string>();

      while (queue.length > 0) {
        const chunk = queue.shift();
        if (!chunk || chunkFiles.has(chunk.fileName)) continue;

        if (chunk.fileName.startsWith("assets/") && chunk.fileName.endsWith(".js")) {
          chunkFiles.add(chunk.fileName);
        }

        // Only follow static imports — dynamic imports load on-demand and
        // shouldn't be eagerly preloaded (avoids pulling in vendor chunks
        // that are already loaded from the initial page render).
        for (const dependency of chunk.imports ?? []) {
          const nextChunk = chunkMap.get(dependency);
          if (nextChunk && !chunkFiles.has(nextChunk.fileName)) {
            queue.push(nextChunk);
          }
        }
      }

      if (chunkFiles.size === 0) return;

      const manifest = { meetingChunks: [...chunkFiles].sort().map((fileName) => "/" + fileName) };
      this.emitFile({
        type: "asset",
        fileName: "meeting-chunks.json",
        source: JSON.stringify(manifest),
      });
    },
  };
}
