#!/usr/bin/env node
/**
 * Prepares and verifies browser-served build assets.
 *
 * - MediaPipe WASM/model files used by background effects.
 * - Whiteboard engine assets from packages/whiteboard.
 */

import {
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { findSinglePnpmPackageDir, readPackageJson } from "./pnpm-packages.mjs";

const root = resolve(import.meta.dirname, "..");
const command = process.argv[2] ?? "prepare";
const WHITEBOARD_RUNTIME_PROFILE = "packages/whiteboard/src/runtime-profile.mjs";

const TEXT_FILE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
]);

export const PUBLIC_RUNTIME_ASSETS = [
  {
    id: "mediapipe/tasks-vision",
    packageName: "@mediapipe/tasks-vision",
    packageVersion: "0.10.14",
    sourceDir: "wasm",
    publicDir: "apps/web/public/wasm/mediapipe",
    files: [
      { name: "vision_wasm_internal.js", minBytes: 1024 },
      { name: "vision_wasm_internal.wasm", minBytes: 1024 * 1024 },
      { name: "vision_wasm_nosimd_internal.js", minBytes: 1024 },
      { name: "vision_wasm_nosimd_internal.wasm", minBytes: 1024 * 1024 },
    ],
    generatedFiles: [
      {
        path: "apps/web/public/wasm/mediapipe/selfie_segmenter.tflite",
        minBytes: 1024,
        sha256: "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b",
      },
    ],
    downloads: [
      {
        path: "apps/web/public/wasm/mediapipe/selfie_segmenter.tflite",
        url: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
        sha256: "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b",
      },
    ],
  },
];

if (command === "prepare") {
  await prepareRuntimeAssets();
} else if (command === "check") {
  await checkRuntimeAssets();
} else {
  console.error(`Usage: node scripts/setup-assets.mjs <prepare|check>`);
  process.exit(1);
}

async function prepareRuntimeAssets() {
  await prepareMediaPipeAssets();
  await prepareWhiteboardAssets();
  await checkRuntimeAssets();
}

async function prepareMediaPipeAssets() {
  for (const runtimeAsset of PUBLIC_RUNTIME_ASSETS) {
    const packageDir = findSinglePnpmPackageDir(
      root,
      runtimeAsset.packageName,
      runtimeAsset.packageVersion,
    );
    const packageJson = readPackageJson(packageDir);
    if (packageJson.version !== runtimeAsset.packageVersion) {
      throw new Error(
        `${runtimeAsset.packageName} version mismatch: expected ${runtimeAsset.packageVersion}, found ${packageJson.version}`,
      );
    }

    const src = resolve(packageDir, runtimeAsset.sourceDir);
    const dest = resolve(root, runtimeAsset.publicDir);
    if (!existsSync(src)) {
      console.error(`[runtime] Could not find ${runtimeAsset.packageName}/${runtimeAsset.sourceDir}`);
      console.error("Run `pnpm install` first, then rerun runtime preparation.");
      process.exit(1);
    }

    mkdirSync(dest, { recursive: true });

    let copied = 0;
    for (const file of runtimeAsset.files) {
      const srcFile = resolve(src, file.name);
      const destFile = resolve(dest, file.name);
      const srcSize = statSync(srcFile).size;
      if (existsSync(destFile) && statSync(destFile).size === srcSize) continue;
      copyFileSync(srcFile, destFile);
      copied++;
    }

    for (const download of runtimeAsset.downloads ?? []) {
      if (await hasExpectedSha256(resolve(root, download.path), download.sha256)) continue;
      await downloadFile(download.url, resolve(root, download.path), download.sha256);
    }

    if (copied > 0) {
      console.log(`[runtime] Materialized ${copied} files from ${packageJson.name}@${packageJson.version}`);
    } else {
      console.log(`[runtime] ${packageJson.name}@${packageJson.version} files already up-to-date`);
    }
  }
}

async function prepareWhiteboardAssets() {
  const spec = await loadWhiteboardRuntimeSpec();

  if (spec.prepareScripts.length === 0 && spec.copyBundles.length === 0) {
    console.log("[runtime] No whiteboard runtime bundles to prepare");
    return;
  }

  for (const script of spec.prepareScripts) {
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      stdio: "inherit",
    });

    if (result.signal) {
      throw new Error(`Runtime step terminated by ${result.signal}: node ${script}`);
    }
    if (result.status !== 0) {
      throw new Error(`Runtime step failed (${result.status}): node ${script}`);
    }
  }

  let copiedCount = 0;
  for (const bundle of spec.copyBundles) {
    const source = resolve(root, bundle.sourceDir);
    if (!existsSync(source)) continue;

    const destination = resolve(root, bundle.publicDir);
    mkdirSync(destination, { recursive: true });
    cpSync(source, destination, { recursive: true, force: true });
    copiedCount += 1;
  }

  if (copiedCount > 0) {
    console.log(`[runtime] Materialized ${copiedCount} whiteboard runtime bundle(s)`);
  } else {
    console.log("[runtime] No whiteboard runtime bundles found");
  }
}

async function checkRuntimeAssets() {
  const failures = [];
  const spec = await loadWhiteboardRuntimeSpec();

  for (const runtimeAsset of PUBLIC_RUNTIME_ASSETS) {
    try {
      const packageDir = findSinglePnpmPackageDir(root, runtimeAsset.packageName, runtimeAsset.packageVersion);
      const packageJson = readPackageJson(packageDir);
      if (packageJson.version !== runtimeAsset.packageVersion) {
        failures.push(
          `${runtimeAsset.packageName} version mismatch: expected ${runtimeAsset.packageVersion}, found ${packageJson.version}`,
        );
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  const requiredAssets = [
    ...PUBLIC_RUNTIME_ASSETS.flatMap((runtimeAsset) => [
      ...runtimeAsset.files.map((file) => ({
        path: `${runtimeAsset.publicDir}/${file.name}`,
        minBytes: file.minBytes,
        sha256: file.sha256,
      })),
      ...(runtimeAsset.generatedFiles ?? []),
    ]),
    ...spec.requiredAssets,
  ];

  for (const packageRequirement of spec.packages) {
    try {
      const packageDir = findSinglePnpmPackageDir(root, packageRequirement.name, packageRequirement.version);
      const packageJson = readPackageJson(packageDir);
      if (packageJson.version !== packageRequirement.version) {
        failures.push(
          `${packageRequirement.name} version mismatch: expected ${packageRequirement.version}, found ${packageJson.version}`,
        );
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const versionFile of spec.generatedVersionFiles) {
    const filePath = resolve(root, versionFile.path);
    if (!existsSync(filePath)) {
      failures.push(`${versionFile.path} is missing`);
      continue;
    }

    try {
      const packageDir = findSinglePnpmPackageDir(root, versionFile.packageName, versionFile.packageVersion);
      const packageJson = readPackageJson(packageDir);
      const source = readFileSync(filePath, "utf8");
      const match = source.match(new RegExp(versionFile.pattern));
      const generatedVersion = match?.[1]?.trim() ?? null;

      if (!generatedVersion) {
        failures.push(`${versionFile.path} does not contain ${versionFile.id} version metadata`);
      } else if (generatedVersion !== packageJson.version) {
        failures.push(
          `${versionFile.id} version mismatch: ${generatedVersion} in ${versionFile.path}, ${packageJson.version} in node_modules`,
        );
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

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

    if (asset.sha256) {
      const actual = sha256File(abs);
      if (actual !== asset.sha256) {
        failures.push(`${asset.path} checksum mismatch: expected ${asset.sha256}, found ${actual}`);
      }
    }
  }

  for (const filePath of collectDenylistFiles(spec)) {
    const source = readFileSync(resolve(root, filePath), "utf8");
    for (const deniedValue of spec.outputDenylist) {
      if (source.includes(deniedValue)) {
        failures.push(`${filePath} contains forbidden output reference: ${deniedValue}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("[runtime] Required runtime files are not ready:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log(`[runtime] Verified ${requiredAssets.length} runtime files`);
}

async function loadWhiteboardRuntimeSpec() {
  const profilePath = resolve(root, WHITEBOARD_RUNTIME_PROFILE);
  if (!existsSync(profilePath)) return emptySpec();

  const manifest = await import(`${pathToFileURL(profilePath).href}?t=${Date.now()}`);
  return {
    prepareScripts: manifest.PREPARE_SCRIPTS ?? [],
    copyBundles: manifest.COPY_BUNDLES ?? [],
    requiredAssets: manifest.REQUIRED_ASSETS ?? [],
    packages: manifest.PACKAGES ?? [],
    generatedVersionFiles: manifest.GENERATED_VERSION_FILES ?? [],
    outputDenylist: manifest.OUTPUT_DENYLIST ?? [],
  };
}

function emptySpec() {
  return {
    prepareScripts: [],
    copyBundles: [],
    requiredAssets: [],
    packages: [],
    generatedVersionFiles: [],
    outputDenylist: [],
  };
}

async function downloadFile(url, destination, expectedSha256) {
  mkdirSync(dirname(destination), { recursive: true });
  console.log(`[runtime] Downloading ${url}`);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));

  const actualSha256 = sha256File(destination);
  if (actualSha256 !== expectedSha256) {
    rmSync(destination, { force: true });
    throw new Error(
      `Downloaded asset checksum mismatch for ${url}: expected ${expectedSha256}, found ${actualSha256}`,
    );
  }
}

async function hasExpectedSha256(filePath, expectedSha256) {
  return existsSync(filePath) && sha256File(filePath) === expectedSha256;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function collectDenylistFiles(spec) {
  if (spec.outputDenylist.length === 0) return [];

  const candidateRoots = [
    "apps/web/src/generated",
    ...PUBLIC_RUNTIME_ASSETS.map((asset) => asset.publicDir),
    ...spec.copyBundles.map((bundle) => bundle.publicDir),
  ];

  const files = new Set();
  for (const candidateRoot of candidateRoots) {
    for (const filePath of walkTextFiles(candidateRoot)) {
      files.add(filePath);
    }
  }

  return [...files];
}

function walkTextFiles(relativeDir) {
  const absoluteDir = resolve(root, relativeDir);
  if (!existsSync(absoluteDir)) return [];

  const matches = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const childRelativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      matches.push(...walkTextFiles(childRelativePath));
      continue;
    }

    if (TEXT_FILE_EXTENSIONS.has(extname(entry.name))) {
      matches.push(childRelativePath);
    }
  }

  return matches;
}
