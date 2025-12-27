import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import os from "node:os";

// 适度并行：根据 CPU 核心数动态分配 2-4 个 worker，加速运行同时避免 jsdom 过度并发。
const cpuCount = os.cpus()?.length ?? 4;
const parallelWorkers = Math.min(Math.max(2, Math.floor(cpuCount / 2)), 4);

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
    include: ["src/**/*.{test,spec}.ts", "tools/docs-screenshots/__tests__/**/*.{test,spec}.ts"],
    // 允许有限并行（2-4 个 worker），在多数机器上可显著缩短整体耗时。
    maxWorkers: parallelWorkers,
    // Use separate Node processes instead of threads so memory can be fully
    // reclaimed between runs of heavy test files.
    pool: "forks",
    // Allow extra time for workers to clean up pending module requests before
    // forceful shutdown (avoids "Closing rpc while fetch was pending" errors).
    teardownTimeout: 3000,
    // Give each worker a larger heap to avoid repeated GC thrashing and
    // out-of-memory crashes when mounting MainApp + jsdom.
    execArgv: ["--max-old-space-size=8192"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
