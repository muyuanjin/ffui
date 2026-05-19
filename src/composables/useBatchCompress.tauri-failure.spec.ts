import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { useBatchCompress } from "./useBatchCompress";
import { buildBatchCompressDefaults } from "../__tests__/helpers/batchCompressDefaults";

const runAutoCompressMock = vi.fn<(_rootPath: string, _config: unknown) => Promise<never>>(async () => {
  throw new Error("backend failed");
});

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  runAutoCompress: (rootPath: string, config: unknown) => runAutoCompressMock(rootPath, config),
}));

describe("useBatchCompress Tauri failures", () => {
  it("sets queueError and does not add mock jobs when runAutoCompress rejects", async () => {
    const jobs = ref([]);
    const queueError = ref<string | null>(null);

    const batch = useBatchCompress({
      jobs,
      batchCompressJobs: ref([]),
      presets: ref([]),
      queueError,
      lastDroppedRoot: ref(null),
      activeTab: ref("queue"),
      t: (key: string) =>
        key === "queue.error.autoCompressFailed"
          ? "Batch Compress failed to start. Check external tools or enable auto-download, then try again."
          : "",
    });

    await batch.runBatchCompress(buildBatchCompressDefaults({ rootPath: "C:/media" }));

    expect(runAutoCompressMock).toHaveBeenCalledTimes(1);
    expect(jobs.value).toEqual([]);
    expect(queueError.value).toBe(
      "Batch Compress failed to start. Check external tools or enable auto-download, then try again.",
    );
    expect(queueError.value).not.toMatch(/simulated|模拟结果/i);
  });
});
