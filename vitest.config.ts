import { existsSync } from "node:fs";
import { defineConfig } from 'vitest/config'

const projects = [
  'packages/shared/vitest.config.ts',
  'apps/web/vitest.config.ts',
];

if (existsSync(new URL("./packages/whiteboard/vitest.config.ts", import.meta.url))) {
  projects.push('packages/whiteboard/vitest.config.ts');
}

export default defineConfig({
  test: {
    projects,
  },
})
