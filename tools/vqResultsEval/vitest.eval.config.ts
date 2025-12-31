import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tools/vqResultsEval/**/*.{test,spec}.ts"],
    // Keep this eval deterministic and polite to shared machines.
    maxWorkers: 1,
    pool: "forks",
    teardownTimeout: 5000,
  },
});
