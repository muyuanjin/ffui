import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tools/perf/**/*.{test,spec}.ts"],
    maxWorkers: 1,
    minWorkers: 1,
    pool: "forks",
    teardownTimeout: 3000,
    execArgv: ["--max-old-space-size=8192"],
  },
});
