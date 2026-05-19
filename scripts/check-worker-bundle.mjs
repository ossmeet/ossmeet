import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const serverAssetsDir = new URL("../apps/web/dist/server/assets", import.meta.url);

const forbiddenFilePatterns = [
  {
    pattern: /^vendor-surface-text-.*\.js$/,
    reason: "Markdown/KaTeX renderer must stay client-only.",
  },
  {
    pattern: /^whiteboard-runtime-.*\.js$/,
    reason: "@whiteboard/runtime must be SSR-stubbed in the Worker build.",
  },
];

const forbiddenContentPatterns = [
  {
    pattern: /node_modules\/\.pnpm\/react-markdown@/,
    reason: "react-markdown is a browser renderer and should not ship in the Worker.",
  },
  {
    pattern: /node_modules\/\.pnpm\/rehype-katex@/,
    reason: "rehype-katex is a browser renderer and should not ship in the Worker.",
  },
  {
    pattern: /node_modules\/\.pnpm\/remark-math@/,
    reason: "remark-math is only needed by browser Markdown rendering.",
  },
  {
    pattern: /node_modules\/\.pnpm\/katex@/,
    reason: "KaTeX is only needed by browser Markdown rendering.",
  },
  {
    pattern: /node_modules\/\.pnpm\/@simplewebauthn\+browser@/,
    reason: "@simplewebauthn/browser must be SSR-stubbed in the Worker build.",
  },
  {
    pattern: /node_modules\/\.pnpm\/ai@/,
    reason: "Vercel AI SDK must not ship in the Worker after the TanStack AI migration.",
  },
  {
    pattern: /node_modules\/\.pnpm\/@ai-sdk\+/,
    reason: "Vercel AI SDK provider packages must not ship in the Worker.",
  },
  {
    pattern: /node_modules\/\.pnpm\/@vercel\+oidc@/,
    reason: "@vercel/oidc was pulled by the Vercel AI SDK and should stay out of the Worker.",
  },
  {
    pattern: /node_modules\/\.pnpm\/@google\+genai@/,
    reason: "The official Gemini SDK is too large for the Worker bundle; use the fetch adapter.",
  },
  {
    pattern: /node_modules\/\.pnpm\/@base-ui\+react@/,
    reason: "@base-ui/react must be SSR-stubbed in the Worker build.",
  },
  {
    pattern: /node_modules\/\.pnpm\/@base-ui\+utils@/,
    reason: "@base-ui utils must be SSR-stubbed in the Worker build.",
  },
  {
    pattern: /node_modules\/\.pnpm\/@floating-ui\+/,
    reason: "Floating UI is only needed by client-side Base UI components.",
  },
  {
    pattern: /node_modules\/\.pnpm\/react-remove-scroll/,
    reason: "react-remove-scroll is only needed by client-side overlays.",
  },
];

if (!existsSync(serverAssetsDir)) {
  throw new Error(
    `Worker bundle assets not found at ${serverAssetsDir.pathname}. Run the web build first.`,
  );
}

const failures = [];
let totalJsBytes = 0;

for (const name of readdirSync(serverAssetsDir)) {
  if (!name.endsWith(".js")) continue;

  const relativePath = `apps/web/dist/server/assets/${name}`;
  const fullPath = join(serverAssetsDir.pathname, name);
  totalJsBytes += statSync(fullPath).size;

  for (const { pattern, reason } of forbiddenFilePatterns) {
    if (pattern.test(name)) {
      failures.push(`${relativePath}: ${reason}`);
    }
  }

  const code = readFileSync(fullPath, "utf8");
  for (const { pattern, reason } of forbiddenContentPatterns) {
    if (pattern.test(code)) {
      failures.push(`${relativePath}: ${reason}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Worker bundle contains client-only modules:\n${failures.join("\n")}`);
}

const relativeRoot = root.pathname;
console.log(
  `[worker-bundle] checked ${serverAssetsDir.pathname.replace(relativeRoot, "")} (${totalJsBytes} JS bytes)`,
);
