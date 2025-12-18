// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { ref } from "vue";
import useBatchCompress from "./useBatchCompress";
import type { FFmpegPreset, BatchCompressConfig, TranscodeJob } from "@/types";
import { buildBatchCompressDefaults } from "../__tests__/helpers/batchCompressDefaults";

describe("useBatchCompress.runBatchCompressMock - 音频批次", () => {
  it("在仅启用音频过滤时生成 audio 类型子任务并聚合为批次", () => {
    const jobs = ref<TranscodeJob[]>([]);
    const batchCompressJobs = ref<TranscodeJob[]>([]);
    const presets = ref<FFmpegPreset[]>([]);
    const queueError = ref<string | null>(null);
    const lastDroppedRoot = ref<string | null>(null);
    const activeTab = ref("queue");

    const { runBatchCompressMock, compositeBatchCompressTasks } = useBatchCompress({
      jobs,
      batchCompressJobs,
      presets,
      queueError,
      lastDroppedRoot,
      activeTab,
      t: (key: string) => key,
    });

    const config: BatchCompressConfig = buildBatchCompressDefaults({
      // 仅启用音频过滤，确保 mock 生成的所有子任务都是 audio 类型。
      videoFilter: { enabled: false, extensions: [] },
      imageFilter: { enabled: false, extensions: [] },
      audioFilter: {
        enabled: true,
        extensions: ["mp3", "wav"],
      },
    });

    runBatchCompressMock(config);

    expect(jobs.value.length).toBeGreaterThan(0);
    expect(jobs.value.every((j) => j.type === "audio")).toBe(true);

    const batches = compositeBatchCompressTasks.value;
    expect(batches.length).toBeGreaterThan(0);
    const batch = batches[0];
    expect(batch.jobs.length).toBe(jobs.value.length);
    expect(batch.jobs.every((j) => j.type === "audio")).toBe(true);
  });
});
