import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const webDir = resolve(root, "apps/web");

const required = [
  {
    file: resolve(webDir, "wrangler.jsonc"),
    example: "apps/web/wrangler.jsonc.example",
    name: "wrangler.jsonc",
  },
  {
    file: resolve(webDir, ".dev.vars"),
    example: "apps/web/.dev.vars.example",
    name: ".dev.vars",
  },
];

const missing = required.filter((r) => !existsSync(r.file));

if (missing.length > 0) {
  console.error("\n  Missing required config files:\n");
  for (const m of missing) {
    console.error(`    - apps/web/${m.name}`);
  }
  console.error("\n  Run:\n");
  for (const m of missing) {
    console.error(`    cp ${m.example} apps/web/${m.name}`);
  }
  console.error("\n  Then fill in your secrets in .dev.vars. See README.md for details.\n");
  process.exit(1);
}
