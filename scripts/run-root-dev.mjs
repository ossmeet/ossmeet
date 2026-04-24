#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const whiteboardAvailable = existsSync(resolve(root, "packages/whiteboard/package.json"));
const bunCheck = spawnSync(process.platform === "win32" ? "bun.cmd" : "bun", ["--version"], {
  cwd: root,
  stdio: "ignore",
});
const bunAvailable = bunCheck.status === 0;

const commands = [
  {
    name: "web",
    args: ["--filter", "@ossmeet/web", "dev"],
  },
];

if (whiteboardAvailable && bunAvailable) {
  commands.push(
    {
      name: "whiteboard:bundle",
      args: ["--dir", "packages/whiteboard", "dev"],
    },
    {
      name: "whiteboard:server",
      args: ["--dir", "packages/whiteboard", "start"],
    },
  );
}

const children = [];
let shuttingDown = false;

if (whiteboardAvailable && bunAvailable) {
  console.log("[run-root-dev] Starting web + private whiteboard services");
} else if (whiteboardAvailable) {
  console.log("[run-root-dev] Whiteboard overlay detected but bun is unavailable; starting web only");
} else {
  console.log("[run-root-dev] Starting web in public mode");
}

function stopAll(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const command of commands) {
  const child = spawn(pnpmCmd, command.args, {
    cwd: root,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    stopAll();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  children.push(child);
}

process.on("SIGINT", () => {
  stopAll("SIGINT");
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopAll("SIGTERM");
  process.exit(143);
});
