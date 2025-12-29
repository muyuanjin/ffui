// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { nextTick } from "vue";
import {
  buildAutoCompressResult,
  defaultAppSettings,
  emitBatchCompressProgress,
  emitQueueState,
  getQueueJobs,
  i18n,
  setQueueJobs,
  useBackendMock,
} from "./helpers/mainAppTauriDialog";
import { withMainAppVmCompat } from "./helpers/mainAppVmCompat";
import { mount } from "@vue/test-utils";
import MainApp from "@/MainApp.vue";
import type { AutoCompressProgress, TranscodeJob } from "@/types";

// BatchCompressWizard 使用 reka-ui Slider，会依赖 ResizeObserver。
// 在 jsdom 测试环境中手动提供一个最小的 polyfill，避免挂载时报错。
if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

async function flushQueuedQueueStateApply() {
  await nextTick();
  await new Promise((r) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => r(null));
    } else {
      setTimeout(r, 0);
    }
  });
  await nextTick();
}

describe("MainApp Batch Compress integration (queue snapshots)", () => {
  it("creates Batch Compress batch cards from Tauri batch metadata and queue events", async () => {
    const batchId = "auto-compress-test-batch";
    const rootPath = "C:/videos/batch";

    useBackendMock({
      get_queue_state: () => ({ jobs: [] }),
      get_app_settings: () => defaultAppSettings(),
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
      run_auto_compress: () => buildAutoCompressResult(rootPath, { completedAtMs: 0, batchId }),
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = withMainAppVmCompat(wrapper);

    vm.lastDroppedRoot = rootPath;

    const config = {
      rootPath: rootPath,
      replaceOriginal: true,
      minImageSizeKB: 10,
      minVideoSizeMB: 10,
      minAudioSizeKB: 500,
      savingConditionType: "ratio" as const,
      minSavingRatio: 0.8,
      minSavingAbsoluteMB: 5,
      imageTargetFormat: "avif" as const,
      videoPresetId: "",
      audioPresetId: "",
      videoFilter: { enabled: true, extensions: ["mp4", "mkv"] },
      imageFilter: { enabled: true, extensions: ["jpg", "png"] },
      audioFilter: { enabled: false, extensions: ["mp3"] },
    };

    await vm.runBatchCompress(config);
    await nextTick();

    expect(vm.batchCompressBatchMeta[batchId]).toBeTruthy();

    let batchCards = wrapper.findAll("[data-testid='batch-compress-batch-card']");
    expect(batchCards.length).toBe(1);

    const job: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/input1.mp4",
      type: "video",
      source: "batch_compress",
      originalSizeMB: 100,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "processing",
      progress: 10,
      logs: [],
      batchId,
    } as any;

    setQueueJobs([job]);
    emitQueueState(getQueueJobs());
    await flushQueuedQueueStateApply();

    const progress: AutoCompressProgress = {
      rootPath,
      totalFilesScanned: 1,
      totalCandidates: 1,
      totalProcessed: 1,
      batchId,
    };
    emitBatchCompressProgress(progress);
    await nextTick();

    batchCards = wrapper.findAll("[data-testid='batch-compress-batch-card']");
    expect(batchCards.length).toBe(1);

    const text = batchCards[0].text();
    expect(text).toContain("1 / 1");

    wrapper.unmount();
  });

  it("renders all Batch Compress children immediately when queue snapshot arrives", async () => {
    const batchId = "auto-compress-bulk-batch";
    const rootPath = "C:/videos/bulk";

    useBackendMock({
      get_queue_state: () => ({ jobs: [] }),
      get_app_settings: () => defaultAppSettings(),
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
      run_auto_compress: () =>
        buildAutoCompressResult(rootPath, {
          completedAtMs: 0,
          batchId,
          totalFilesScanned: 0,
          totalCandidates: 0,
          totalProcessed: 0,
        }),
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = withMainAppVmCompat(wrapper);

    vm.lastDroppedRoot = rootPath;

    const config = {
      rootPath,
      replaceOriginal: true,
      minImageSizeKB: 0,
      minVideoSizeMB: 0,
      minAudioSizeKB: 0,
      savingConditionType: "ratio" as const,
      minSavingRatio: 0.8,
      minSavingAbsoluteMB: 0,
      imageTargetFormat: "avif" as const,
      videoPresetId: "preset-1",
      audioPresetId: "",
      videoFilter: { enabled: true, extensions: ["mp4", "mkv"] },
      imageFilter: { enabled: false, extensions: [] },
      audioFilter: { enabled: false, extensions: [] },
    };

    await vm.runBatchCompress(config);
    await nextTick();

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/bulk1.mp4",
        type: "video",
        source: "batch_compress",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "queued",
        progress: 0,
        logs: [],
        batchId,
      } as any,
      {
        id: "job-2",
        filename: "C:/videos/bulk2.mkv",
        type: "video",
        source: "batch_compress",
        originalSizeMB: 15,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "queued",
        progress: 0,
        logs: [],
        batchId,
      } as any,
    ];

    setQueueJobs(jobs);
    emitQueueState(getQueueJobs());
    await flushQueuedQueueStateApply();

    let tasks: any[] = vm.compositeBatchCompressTasks;
    expect(tasks.length).toBe(1);
    expect(tasks[0].jobs.length).toBe(2);
    expect(tasks[0].totalCount).toBe(2);

    emitBatchCompressProgress({
      rootPath,
      totalFilesScanned: 2,
      totalCandidates: 2,
      totalProcessed: 0,
      batchId,
    });
    await nextTick();

    tasks = vm.compositeBatchCompressTasks;
    expect(tasks[0].totalCandidates).toBe(2);

    wrapper.unmount();
  });
});
