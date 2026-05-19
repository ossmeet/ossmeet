import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "whiteboard",
    environment: "node",
    include: ["src/**/*.test.{ts,tsx,js,mjs}"],
  },
  resolve: {
    alias: {
      "@/server/auth/helpers": fileURLToPath(
        new URL("../../apps/web/src/server/auth/helpers.ts", import.meta.url)
      ),
    },
  },
});
