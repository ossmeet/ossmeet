import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const _addonPath = fileURLToPath(new URL("./addons.mjs", import.meta.url));
const _addon = existsSync(_addonPath)
  ? await import(`${pathToFileURL(_addonPath).href}?t=${Date.now()}`)
  : {};

export const PREPARE_SCRIPTS = [
  "packages/whiteboard/scripts/sync-assets.mjs",
  ...(_addon.prepareScripts ?? []),
];

export const COPY_BUNDLES = _addon.copyBundles ?? [];

export const REQUIRED_ASSETS = [
  { path: "apps/web/public/wb-assets/icons/icon/0_merged.svg", minBytes: 1024 },
  { path: "apps/web/public/wb-assets/translations/en.json", minBytes: 1 },
  { path: "apps/web/public/wb-assets/fonts/IBMPlexSans-Medium.woff2", minBytes: 1024 },
  ...(_addon.requiredAssets ?? []),
];

export const PACKAGES = [
  { name: "@tldraw/editor", version: "5.0.1" },
  { name: "tldraw", version: "5.0.1" },
  ...(_addon.packages ?? []),
];

export const GENERATED_VERSION_FILES = [
  {
    id: "whiteboard asset URL map",
    path: "packages/whiteboard/src/generated/wb-asset-urls.ts",
    pattern: "Whiteboard engine assets . version ([^\\n]+)",
    packageName: "tldraw",
    packageVersion: "5.0.1",
  },
];

export const OUTPUT_DENYLIST = [
  "https://cdn.tldraw.com",
  "https://integrations.livekit.io",
  ...(_addon.outputDenylist ?? []),
];
