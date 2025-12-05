// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { nextTick } from "vue";
import {
  defaultAppSettings,
  dialogOpenMock,
  emitQueueState,
  i18n,
  invokeMock,
  useBackendMock,
} from "./helpers/mainAppTauriDialog";
import { mount } from "@vue/test-utils";
import MainApp from "@/MainApp.vue";
import type { FFmpegPreset, AppSettings, TranscodeJob } from "@/types";

describe("MainApp Tauri presets", () => {
  it("saves new presets to the backend before using them for manual jobs", async () => {
    const selectedPath = "C:/videos/custom-preset.mp4";
    dialogOpenMock.mockResolvedValueOnce(selectedPath);

    const backendPresets: FFmpegPreset[] = [
      {
        id: "p1",
        name: "Universal 1080p",
        description: "x264 Medium CRF 23. Standard for web.",
        video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
        audio: { codec: "copy" },
        filters: { scale: "-2:1080" },
        stats: { usageCount: 5, totalInputSizeMB: 2500, totalOutputSizeMB: 800, totalTimeSeconds: 420 },
      },
      {
        id: "p2",
        name: "Archive Master",
        description: "x264 Slow CRF 18. Near lossless.",
        video: { encoder: "libx264", rateControl: "crf", qualityValue: 18, preset: "slow" },
        audio: { codec: "copy" },
        filters: {},
        stats: { usageCount: 2, totalInputSizeMB: 5000, totalOutputSizeMB: 3500, totalTimeSeconds: 1200 },
      },
    ];

    let queue: TranscodeJob[] = [];

    useBackendMock({
      get_queue_state: () => ({ jobs: queue }),
      get_presets: () => backendPresets,
      get_app_settings: () => defaultAppSettings(),
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
      run_auto_compress: () => null,
      save_app_settings: ({ settings } = {}) => settings,
      save_preset: ({ preset } = {}) => {
        const next = (preset ?? {}) as FFmpegPreset;
        const idx = backendPresets.findIndex((p) => p.id === next.id);
        if (idx >= 0) backendPresets[idx] = next; else backendPresets.push(next);
        return backendPresets;
      },
      enqueue_transcode_job: (payload) => {
        const presetId = (payload?.presetId as string) ?? "";
        expect(backendPresets.some((p) => p.id === presetId)).toBe(true);
        const job: TranscodeJob = {
          id: "job-custom-1",
          filename: (payload?.filename as string) ?? "",
          type: ((payload?.jobType as string) ?? "video") as TranscodeJob["type"],
          source: (payload?.source as TranscodeJob["source"]) ?? "manual",
          originalSizeMB: (payload?.originalSizeMb as number) ?? 0,
          originalCodec: (payload?.originalCodec as string) ?? "h264",
          presetId,
          status: "waiting",
          progress: 0,
          logs: [],
        };
        queue = [job, ...queue];
        emitQueueState(queue);
        return job;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

    const newPreset: FFmpegPreset = {
      id: "custom-preset-1",
      name: "Custom Preset 1",
      description: "User defined preset",
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 22, preset: "fast" },
      audio: { codec: "aac", bitrate: 192 },
      filters: {},
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
    };

    await vm.handleSavePreset(newPreset);
    vm.manualJobPresetId = newPreset.id;

    await vm.addManualJob();
    await nextTick();

    const jobsAfter = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(jobsAfter.length).toBe(1);
    expect(jobsAfter[0].presetId).toBe(newPreset.id);

    const savePresetCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "save_preset");
    const enqueueCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "enqueue_transcode_job");
    expect(savePresetCalls.length).toBe(1);
    expect(enqueueCalls.length).toBe(1);

    const firstSaveIndex = invokeMock.mock.calls.findIndex(([cmd]) => cmd === "save_preset");
    const firstEnqueueIndex = invokeMock.mock.calls.findIndex(([cmd]) => cmd === "enqueue_transcode_job");
    expect(firstSaveIndex).toBeLessThan(firstEnqueueIndex);

    wrapper.unmount();
  });

  it("restores and persists the queue default preset via AppSettings in Tauri mode", async () => {
    const backendPresets: FFmpegPreset[] = [
      {
        id: "p1",
        name: "Universal 1080p",
        description: "x264 Medium CRF 23. Standard for web.",
        video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
        audio: { codec: "copy" },
        filters: { scale: "-2:1080" },
        stats: { usageCount: 5, totalInputSizeMB: 2500, totalOutputSizeMB: 800, totalTimeSeconds: 420 },
      },
      {
        id: "p2",
        name: "Archive Master",
        description: "x264 Slow CRF 18. Near lossless.",
        video: { encoder: "libx264", rateControl: "crf", qualityValue: 18, preset: "slow" },
        audio: { codec: "copy" },
        filters: {},
        stats: { usageCount: 2, totalInputSizeMB: 5000, totalOutputSizeMB: 3500, totalTimeSeconds: 1200 },
      },
    ];

    const initialSettings: AppSettings = {
      ...defaultAppSettings({
        tools: { autoDownload: true, autoUpdate: false, ffmpegPath: undefined, ffprobePath: undefined, avifencPath: undefined },
        defaultQueuePresetId: "p2",
        smartScanDefaults: {
          minImageSizeKB: 50,
          minVideoSizeMB: 50,
          minSavingRatio: 0.95,
          imageTargetFormat: "avif",
          videoPresetId: "p2",
        },
        maxParallelJobs: 0,
      }),
    } as AppSettings;

    const savedSettings: AppSettings[] = [];

    useBackendMock({
      get_queue_state: () => ({ jobs: [] }),
      get_presets: () => backendPresets,
      get_app_settings: () => initialSettings,
      save_app_settings: ({ settings } = {}) => {
        savedSettings.push(settings as AppSettings);
        return settings;
      },
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    expect(vm.manualJobPresetId).toBe("p2");

    vm.manualJobPresetId = "p1";
    await nextTick();
    await nextTick();

    expect(savedSettings.length).toBeGreaterThan(0);
    const last = savedSettings[savedSettings.length - 1];
    expect(last.defaultQueuePresetId).toBe("p1");

    wrapper.unmount();
  });
});
