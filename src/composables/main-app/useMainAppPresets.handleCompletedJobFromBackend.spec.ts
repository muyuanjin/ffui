// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import type { FFmpegPreset, TranscodeJob } from "@/types";

// 针对本测试，强制 hasTauri() 返回 true，并用可控的 mock 替换 loadPresets。
const loadPresetsMock = vi.fn();

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => true,
    loadPresets: (...args: any[]) => loadPresetsMock(...args),
  };
});

import { useMainAppPresets } from "./useMainAppPresets";

const makePreset = (id: string, usageCount: number): FFmpegPreset => ({
  id,
  name: `Preset ${id}`,
  description: "test preset",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: {
    usageCount,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
});

describe("useMainAppPresets.handleCompletedJobFromBackend", () => {
  it("在 Tauri 环境下优先使用后端返回的预设统计数据", async () => {
    const initial = makePreset("p1", 0);
    const backendUpdated = makePreset("p1", 5);

    const presets = ref<FFmpegPreset[]>([initial]);
    const presetsLoadedFromBackend = ref(false);
    const manualJobPresetId = ref<string | null>(null);

    loadPresetsMock.mockResolvedValueOnce([backendUpdated]);

    const { handleCompletedJobFromBackend } = useMainAppPresets({
      t: (key: string) => key,
      presets,
      presetsLoadedFromBackend,
      manualJobPresetId,
      dialogManager: {
        openParameterPanel: () => {},
        closeParameterPanel: () => {},
        closeWizard: () => {},
      } as any,
      shell: undefined,
    });

    const job: TranscodeJob = {
      id: "job-1",
      filename: "sample.mp4",
      type: "video",
      source: "manual",
      queueOrder: undefined,
      originalSizeMB: 100,
      originalCodec: "h264",
      presetId: "p1",
      status: "completed",
      progress: 100,
      startTime: 0,
      endTime: 1000,
      outputSizeMB: 50,
      logs: [],
    };

    handleCompletedJobFromBackend(job);

    // 等待内部异步 loadPresets 调用完成。
    await Promise.resolve();
    await Promise.resolve();

    expect(loadPresetsMock).toHaveBeenCalledTimes(1);
    expect(presets.value[0].stats.usageCount).toBe(5);
  });
});
