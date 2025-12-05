import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  // Keep Vue SFC support for tests, but avoid pulling Tailwind/Vite CSS
  // processing into Vitest to reduce transform/import overhead.
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Default to a lightweight Node environment. Individual test files that
    // need a DOM opt into jsdom via `// @vitest-environment jsdom` comments.
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.ts"],
    // Run tests in a single worker process to avoid many heavy jsdom suites
    // running at once and exhausting memory.
    maxWorkers: 1,
    fileParallelism: false,
    // Use separate Node processes instead of threads so memory can be fully
    // reclaimed between runs of heavy test files.
    pool: "forks",
    // Give each worker a larger heap to avoid repeated GC thrashing and
    // out-of-memory crashes when mounting MainApp + jsdom.
    execArgv: ["--max-old-space-size=8192"],
  },
});
