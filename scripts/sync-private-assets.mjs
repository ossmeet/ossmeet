#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const privateAssetsDir = resolve(root, ".private/assets");

if (!existsSync(privateAssetsDir)) {
  console.log("[sync-private-assets] No private assets found; continuing in public mode");
  process.exit(0);
}

const privatePublicDir = resolve(root, "apps/web/public/_private");

let copiedCount = 0;

for (const entry of readdirSync(privateAssetsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const source = resolve(privateAssetsDir, entry.name);
  const destination = resolve(privatePublicDir, entry.name);

  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
  copiedCount += 1;
}

if (copiedCount > 0) {
  console.log(`[sync-private-assets] Synced ${copiedCount} private asset bundle(s)`);
} else {
  console.log("[sync-private-assets] No private assets found; continuing in public mode");
}
