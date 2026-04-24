#!/usr/bin/env node
/**
 * Copies the MediaPipe tasks-vision WASM fileset from node_modules into the
 * web app's public directory so it can be served from the same origin.
 *
 * Run automatically via the `prebuild` / `predev` scripts in apps/web, or
 * invoke manually:
 *   node scripts/copy-mediapipe-wasm.mjs
 */
import { cpSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// @mediapipe/tasks-vision is a transitive dep of @livekit/track-processors,
// nested inside pnpm's content-addressable store.  Walk the store to find it.
function findMediapipeWasm() {
  const pnpmDir = join(root, "node_modules/.pnpm");
  if (!existsSync(pnpmDir)) return null;
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith("@mediapipe+tasks-vision@")) continue;
    const candidate = join(pnpmDir, entry, "node_modules/@mediapipe/tasks-vision/wasm");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const src = findMediapipeWasm();
const dest = resolve(root, "apps/web/public/wasm/mediapipe");

if (!src) {
  console.error("[copy-mediapipe-wasm] Could not find @mediapipe/tasks-vision in node_modules.");
  console.error("Run `pnpm install` first.");
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

const files = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

for (const file of files) {
  cpSync(resolve(src, file), resolve(dest, file));
}

console.log(`[copy-mediapipe-wasm] Copied ${files.length} files → ${dest}`);

const modelDest = resolve(dest, "selfie_segmenter.tflite");
if (!existsSync(modelDest)) {
  const MODEL_URL =
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
  console.log("[copy-mediapipe-wasm] Downloading selfie_segmenter.tflite...");
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { Readable } = await import("node:stream");
    const { pipeline } = await import("node:stream/promises");
    const { createWriteStream } = await import("node:fs");
    await pipeline(Readable.fromWeb(res.body), createWriteStream(modelDest));
    console.log("[copy-mediapipe-wasm] Downloaded selfie_segmenter.tflite");
  } catch (err) {
    console.error("[copy-mediapipe-wasm] Failed to download selfie_segmenter.tflite:", err.message);
    process.exit(1);
  }
}
