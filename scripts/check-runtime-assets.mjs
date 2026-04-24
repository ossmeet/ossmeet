#!/usr/bin/env node
/**
 * Verifies self-hosted runtime assets that are required by lazy meeting features.
 *
 * These files are served from apps/web/public so the browser does not need to
 * fetch third-party runtime assets while a meeting is active.
 */
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const whiteboardAvailable = existsSync(resolve(root, "packages/whiteboard/package.json"));

const requiredAssets = [
  { path: "apps/web/public/wasm/mediapipe/vision_wasm_internal.js", minBytes: 1024 },
  { path: "apps/web/public/wasm/mediapipe/vision_wasm_internal.wasm", minBytes: 1024 * 1024 },
  { path: "apps/web/public/wasm/mediapipe/vision_wasm_nosimd_internal.js", minBytes: 1024 },
  { path: "apps/web/public/wasm/mediapipe/vision_wasm_nosimd_internal.wasm", minBytes: 1024 * 1024 },
  { path: "apps/web/public/wasm/mediapipe/selfie_segmenter.tflite", minBytes: 1024 },
];

if (whiteboardAvailable) {
  requiredAssets.push(
    { path: "apps/web/public/wb-assets/icons/icon/0_merged.svg", minBytes: 1024 },
    { path: "apps/web/public/wb-assets/translations/en.json", minBytes: 1 },
    { path: "apps/web/public/wb-assets/fonts/IBMPlexSans-Medium.woff2", minBytes: 1024 }
  );
}

const failures = [];

for (const asset of requiredAssets) {
  const abs = resolve(root, asset.path);
  if (!existsSync(abs)) {
    failures.push(`${asset.path} is missing`);
    continue;
  }

  const size = statSync(abs).size;
  if (size < asset.minBytes) {
    failures.push(`${asset.path} is too small (${size} bytes, expected >= ${asset.minBytes})`);
  }
}

if (failures.length > 0) {
  console.error("[check-runtime-assets] Required runtime assets are not ready:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`[check-runtime-assets] Verified ${requiredAssets.length} runtime assets`);
