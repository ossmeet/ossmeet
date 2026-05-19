import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/shared/vitest.config.ts',
      'packages/whiteboard/vitest.config.ts',
      'apps/web/vitest.config.ts',
    ],
  },
})
