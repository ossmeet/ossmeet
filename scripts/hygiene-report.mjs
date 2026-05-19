import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];
const IGNORED_PARTS = new Set(["node_modules", "dist", "build", "coverage", ".git", "tldraw-main"]);
const GENERATED_RE = /(?:^|\/)(routeTree\.gen\.ts|worker-configuration\.d\.ts|drizzle\/migrations\/)/;
const SOURCE_RE = /\.(?:ts|tsx|js|mjs)$/;
const IMPORT_RE =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
const FILE_URL_RE = /new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;

const ENTRYPOINTS = new Set([
  "apps/web/src/server.ts",
  "apps/web/src/worker-entry.ts",
  "apps/web/src/router.tsx",
  "apps/web/src/routes/__root.tsx",
  "packages/whiteboard/src/index.ts",
  "packages/whiteboard/src/react.tsx",
  "packages/whiteboard/src/build-profile.mjs",
  "packages/whiteboard/src/runtime-profile.mjs",
  "packages/db/src/index.ts",
  "packages/shared/src/index.ts",
]);

const ENTRY_PREFIXES = [
  "apps/web/src/routes/",
  "apps/web/src/test/",
];

function repoFiles() {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return output
    .split("\n")
    .filter(Boolean)
    .filter((file) => SOURCE_RE.test(file))
    .filter((file) => existsSync(path.join(ROOT, file)))
    .filter((file) => !file.split("/").some((part) => IGNORED_PARTS.has(part)))
    .filter((file) => !GENERATED_RE.test(file));
}

function lineCount(file) {
  return readFileSync(path.join(ROOT, file), "utf8").split("\n").length;
}

function resolveImport(fromFile, specifier, filesByPath) {
  if (!specifier || specifier.startsWith("node:")) return null;

  let base;
  if (specifier.startsWith(".")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  } else if (specifier.startsWith("@/")) {
    base = path.posix.join("apps/web/src", specifier.slice(2));
  } else if (specifier.startsWith("@whiteboard/")) {
    const aliases = {
      "@whiteboard/api": "packages/whiteboard/src/web/api-handler.ts",
      "@whiteboard/dashboard": "packages/whiteboard/src/web/whiteboard-dashboard.tsx",
      "@whiteboard/recorder": "packages/whiteboard/src/web/whiteboard-recorder.tsx",
      "@whiteboard/runtime": "packages/whiteboard/src/web/whiteboard-runtime.ts",
      "@whiteboard/server": "packages/whiteboard/src/web/whiteboard-server.ts",
      "@whiteboard/use-audio-cancellation": "packages/whiteboard/src/web/use-audio-cancellation.ts",
    };
    return aliases[specifier] ?? null;
  } else {
    return null;
  }

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => path.posix.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => filesByPath.has(candidate)) ?? null;
}

function importedFiles(file, filesByPath) {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  const imports = new Set();
  for (const match of source.matchAll(IMPORT_RE)) {
    const resolved = resolveImport(file, match[1] ?? match[2], filesByPath);
    if (resolved) imports.add(resolved);
  }
  for (const match of source.matchAll(FILE_URL_RE)) {
    const resolved = resolveImport(file, match[1], filesByPath);
    if (resolved) imports.add(resolved);
  }
  return imports;
}

function isEntrypoint(file) {
  return ENTRYPOINTS.has(file) || ENTRY_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isTest(file) {
  return /(?:^|\/)(?:__tests__\/.*|[^/]+\.(?:test|spec)\.[tj]sx?)$/.test(file);
}

function formatRows(rows, columns) {
  if (rows.length === 0) return "  none";
  return rows
    .map((row) => {
      const cells = columns.map(([key, width]) => String(row[key]).padEnd(width));
      return `  ${cells.join("  ")}`;
    })
    .join("\n");
}

const files = repoFiles();
const filesByPath = new Set(files);
const inbound = new Map(files.map((file) => [file, 0]));

for (const file of files) {
  for (const imported of importedFiles(file, filesByPath)) {
    inbound.set(imported, (inbound.get(imported) ?? 0) + 1);
  }
}

const sizeRows = files
  .map((file) => ({ lines: lineCount(file), file }))
  .filter(({ file, lines }) => lines > (isTest(file) ? 350 : 600))
  .sort((a, b) => b.lines - a.lines);

const orphanRows = files
  .filter((file) => file.includes("/src/"))
  .filter((file) => !file.endsWith(".d.ts"))
  .filter((file) => !isTest(file))
  .filter((file) => !isEntrypoint(file))
  .filter((file) => (inbound.get(file) ?? 0) === 0)
  .map((file) => ({ file, bytes: statSync(path.join(ROOT, file)).size }))
  .sort((a, b) => b.bytes - a.bytes);

console.log("Code hygiene report");
console.log(`Source files scanned: ${files.length}`);
console.log("");
console.log("Oversized files");
console.log(formatRows(sizeRows, [["lines", 7], ["file", 0]]));
console.log("");
console.log("Unreferenced source-file candidates");
console.log(formatRows(orphanRows.slice(0, 80), [["bytes", 7], ["file", 0]]));

if (process.argv.includes("--fail") && (sizeRows.length > 0 || orphanRows.length > 0)) {
  process.exitCode = 1;
}
