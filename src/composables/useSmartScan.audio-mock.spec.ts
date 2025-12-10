// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { ref } from "vue";
import useSmartScan from "./useSmartScan";
import type { FFmpegPreset, SmartScanConfig, TranscodeJob } from "@/types";
import { buildSmartScanDefaults } from "../__tests__/helpers/smartScanDefaults";

describe("useSmartScan.runSmartScanMock - 音频批次", () => {
  it("在仅启用音频过滤时生成 audio 类型子任务并聚合为批次", () => {
    const jobs = ref<TranscodeJob[]>([]);
    const smartScanJobs = ref<TranscodeJob[]>([]);
    const presets = ref<FFmpegPreset[]>([]);
    const queueError = ref<string | null>(null);
    const lastDroppedRoot = ref<string | null>(null);
    const activeTab = ref("queue");

    const { runSmartScanMock, compositeSmartScanTasks } = useSmartScan({
      jobs,
      smartScanJobs,
      presets,
      queueError,
      lastDroppedRoot,
      activeTab,
      t: (key: string) => key,
    });

    const config: SmartScanConfig = buildSmartScanDefaults({
      // 仅启用音频过滤，确保 mock 生成的所有子任务都是 audio 类型。
      videoFilter: { enabled: false, extensions: [] },
      imageFilter: { enabled: false, extensions: [] },
      audioFilter: {
        enabled: true,
        extensions: ["mp3", "wav"],
      },
    });

    runSmartScanMock(config);

    expect(jobs.value.length).toBeGreaterThan(0);
    expect(jobs.value.every((j) => j.type === "audio")).toBe(true);

    const batches = compositeSmartScanTasks.value;
    expect(batches.length).toBeGreaterThan(0);
    const batch = batches[0];
    expect(batch.jobs.length).toBe(jobs.value.length);
    expect(batch.jobs.every((j) => j.type === "audio")).toBe(true);
  });
});
