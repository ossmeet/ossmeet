import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'web',
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
})
