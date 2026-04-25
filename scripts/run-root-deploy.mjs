#!/usr/bin/env node

import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const steps = [
  ["install"],
  ["typecheck"],
  ["--filter", "@ossmeet/web", "build"],
  ["--filter", "@ossmeet/web", "exec", "wrangler", "deploy"],
];

for (const args of steps) {
  console.log(`[run-root-deploy] pnpm ${args.join(" ")}`);
  await new Promise((resolveStep, rejectStep) => {
    const child = spawn(pnpmCmd, args, {
      cwd: root,
      stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        rejectStep(new Error(`Command terminated by ${signal}: pnpm ${args.join(" ")}`));
        return;
      }

      if (code !== 0) {
        rejectStep(new Error(`Command failed (${code}): pnpm ${args.join(" ")}`));
        return;
      }

      resolveStep();
    });
  });
}
