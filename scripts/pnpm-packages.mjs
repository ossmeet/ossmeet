import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function listPnpmPackageDirs(root, packageName, versionPrefix = "") {
  const pnpmDir = join(root, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return [];

  const encodedName = packageName.startsWith("@") ? packageName.replace("/", "+") : packageName;
  const prefix = `${encodedName}@${versionPrefix}`;

  return readdirSync(pnpmDir)
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => join(pnpmDir, entry, "node_modules", packageName))
    .filter((packageDir) => existsSync(join(packageDir, "package.json")));
}

export function findSinglePnpmPackageDir(root, packageName, versionPrefix = "") {
  const matches = listPnpmPackageDirs(root, packageName, versionPrefix);
  if (matches.length === 0) {
    throw new Error(`Cannot find ${packageName}${versionPrefix ? `@${versionPrefix}` : ""} in node_modules/.pnpm`);
  }

  if (matches.length > 1) {
    throw new Error(
      `Expected one ${packageName}${versionPrefix ? `@${versionPrefix}` : ""}, found ${matches.length}`
    );
  }

  return matches[0];
}

export function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
}
