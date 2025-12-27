import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import os from "node:os";

const GiB = 1024 ** 3;

// 适度并行：根据 CPU/内存动态分配 worker，加速运行同时避免 jsdom 过度并发/爆内存。
const cpuCount = os.cpus()?.length ?? 4;
const totalGiB = os.totalmem() / GiB;
const maxWorkersByMem = Math.max(2, Math.floor(Math.max(0, totalGiB - 2) / 3));
const parallelWorkers = Math.min(Math.max(2, Math.floor(cpuCount / 2)), Math.min(8, maxWorkersByMem));
const heapMiB = Math.min(
  8192,
  Math.max(2048, Math.floor((Math.max(0, totalGiB - 2) * 1024) / parallelWorkers / 256) * 256),
);

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
    execArgv: [`--max-old-space-size=${heapMiB}`],
    setupFiles: ["./vitest.setup.ts"],
  },
});
