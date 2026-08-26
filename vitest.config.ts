import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    hookTimeout: 30_000,
    testTimeout: 20_000,
    coverage: { reporter: ["text", "html"] },
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
