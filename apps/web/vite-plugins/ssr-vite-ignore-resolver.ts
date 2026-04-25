import type { Plugin } from "vite";

/**
 * In SSR/Worker builds, Vite's @vite-ignore comment prevents the bundler from
 * rewriting dynamic import paths to their hashed chunk names. This causes
 * Cloudflare Workers to fail at runtime with "No such module" because the
 * literal source path (e.g. "../auth/helpers") doesn't exist in the bundle
 * (the actual file is something like "assets/helpers-BzDp4SP4.js").
 *
 * In client builds, @vite-ignore is intentionally kept: it prevents server-only
 * modules (like auth/helpers which imports @tanstack/react-start/server) from
 * entering the client module graph and tripping import-protection.
 *
 * This plugin detects the pattern:
 *   const FOO_MODULE = "some/path";
 *   ...import(/* @vite-ignore *\/ FOO_MODULE)...
 *
 * and, only in SSR mode, replaces each such call with import("some/path"),
 * allowing Vite to properly bundle and rewrite the path for the Worker bundle.
 */
export function ssrViteIgnoreResolver(): Plugin {
  return {
    name: "ssr-vite-ignore-resolver",
    enforce: "pre",
    transform(code) {
      if (this.environment.config.consumer !== "server") return null;
      if (!code.includes("@vite-ignore")) return null;

      // Collect const MODULE declarations: const VARNAME = "path/string";
      const moduleVars: Record<string, string> = {};
      const constPattern = /\bconst\s+(\w+)\s*=\s*["']([^"']+)["']\s*;/g;
      let m;
      while ((m = constPattern.exec(code)) !== null) {
        moduleVars[m[1]] = m[2];
      }
      if (Object.keys(moduleVars).length === 0) return null;

      let result = code;
      let changed = false;

      for (const [varName, path] of Object.entries(moduleVars)) {
        // Match: import(/* @vite-ignore */ VARNAME)  (with optional whitespace)
        const pattern = new RegExp(
          `import\\s*\\(\\s*/\\*\\s*@vite-ignore\\s*\\*/\\s*${varName}\\s*\\)`,
          "g",
        );
        const replaced = result.replace(pattern, `import("${path}")`);
        if (replaced !== result) {
          result = replaced;
          changed = true;
        }
      }

      return changed ? { code: result, map: null } : null;
    },
  };
}
