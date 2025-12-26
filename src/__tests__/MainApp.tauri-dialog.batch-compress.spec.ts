// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { nextTick } from "vue";
import {
  buildAutoCompressResult,
  defaultAppSettings,
  dialogOpenMock,
  emitBatchCompressProgress,
  getBatchCompressProgressHandler,
  getQueueJobs,
  i18n,
  invokeMock,
  setQueueJobs,
  useBackendMock,
} from "./helpers/mainAppTauriDialog";
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

describe("MainApp Batch Compress integration", () => {
  it("opens Batch Compress wizard directly without directory dialog", async () => {
    // 新行为：点击批量压缩按钮直接打开面板，用户在面板内选择路径
    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
      run_auto_compress: () => null,
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

    expect(vm.lastDroppedRoot).toBe(null);
    expect(vm.showBatchCompress).toBe(false);

    await vm.startBatchCompress();
    await nextTick();

    // 不再调用文件夹选择对话框
    expect(dialogOpenMock).not.toHaveBeenCalled();

    // 直接打开批量压缩面板
    expect(vm.showBatchCompress).toBe(true);
    expect(vm.activeTab).toBe("queue");

    wrapper.unmount();
  });

  it("pre-fills rootPath from lastDroppedRoot when opening Batch Compress wizard", async () => {
    const droppedRoot = "C:/videos/dropped";

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
      run_auto_compress: () => null,
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

    // 模拟之前有拖拽路径
    vm.lastDroppedRoot = droppedRoot;

    await vm.startBatchCompress();
    await nextTick();

    // 面板打开，且配置中预填充了路径
    // smartConfig 是一个 ref，需要访问其 value
    expect(vm.showBatchCompress).toBe(true);
    expect(vm.smartConfig?.rootPath ?? vm.smartConfig).toBeTruthy();

    wrapper.unmount();
  });

  it("subscribes to Batch Compress progress events and updates batch metadata", async () => {
    useBackendMock({
      get_queue_state: () => ({ jobs: [] }),
      get_app_settings: () => defaultAppSettings(),
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

    await nextTick();

    expect(typeof getBatchCompressProgressHandler()).toBe("function");

    const progress: AutoCompressProgress = {
      rootPath: "C:/videos/batch",
      totalFilesScanned: 10,
      totalCandidates: 4,
      totalProcessed: 2,
      batchId: "auto-compress-test-batch",
    };

    emitBatchCompressProgress(progress);
    await nextTick();

    const meta = vm.batchCompressBatchMeta["auto-compress-test-batch"];
    expect(meta).toBeTruthy();
    expect(meta.rootPath).toBe("C:/videos/batch");
    expect(meta.totalFilesScanned).toBe(10);
    expect(meta.totalCandidates).toBe(4);
    expect(meta.totalProcessed).toBe(2);

    wrapper.unmount();
  });

  it("accepts sparse Batch Compress scan progress updates (e.g. 32 -> 33)", async () => {
    useBackendMock({
      get_queue_state: () => ({ jobs: [] }),
      get_app_settings: () => defaultAppSettings(),
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

    await nextTick();

    const batchId = "auto-compress-sparse-scan";
    emitBatchCompressProgress({
      rootPath: "C:/videos/batch",
      totalFilesScanned: 32,
      totalCandidates: 0,
      totalProcessed: 0,
      batchId,
    });
    await nextTick();

    expect(vm.batchCompressBatchMeta[batchId]?.totalFilesScanned).toBe(32);

    emitBatchCompressProgress({
      rootPath: "C:/videos/batch",
      totalFilesScanned: 33,
      totalCandidates: 0,
      totalProcessed: 0,
      batchId,
      completedAtMs: 123,
    });
    await nextTick();

    expect(vm.batchCompressBatchMeta[batchId]?.totalFilesScanned).toBe(33);
    expect(vm.batchCompressBatchMeta[batchId]?.completedAtMs).toBe(123);

    wrapper.unmount();
  });

  it("refreshes queue snapshot from backend when Batch Compress progress arrives without a queue event", async () => {
    const batchId = "auto-compress-progress-refresh";
    const rootPath = "C:/videos/progress-refresh";

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
      run_auto_compress: () =>
        buildAutoCompressResult(rootPath, {
          completedAtMs: 0,
          batchId,
        }),
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

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

    const callsBefore = invokeMock.mock.calls.filter(([cmd]) => cmd === "get_queue_state_lite").length;

    const job: TranscodeJob = {
      id: "job-progress-1",
      filename: "C:/videos/progress-refresh.mp4",
      type: "video",
      source: "batch_compress",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
      batchId,
    } as any;

    setQueueJobs([job]);

    const progress: AutoCompressProgress = {
      rootPath,
      totalFilesScanned: 1,
      totalCandidates: 1,
      totalProcessed: 0,
      batchId,
    };
    emitBatchCompressProgress(progress);

    await nextTick();
    await nextTick();

    const callsAfter = invokeMock.mock.calls.filter(([cmd]) => cmd === "get_queue_state_lite").length;
    expect(callsAfter).toBeGreaterThan(callsBefore);

    wrapper.unmount();
  });

  it("hides empty Batch Compress batches once zero-candidate progress marks the batch as completed", async () => {
    const batchId = "auto-compress-empty-batch";
    const rootPath = "C:/videos/empty-batch";

    useBackendMock({
      get_queue_state: () => ({ jobs: [] }),
      get_app_settings: () => defaultAppSettings(),
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
      run_auto_compress: () =>
        // 初始描述符：0 个候选且 completedAtMs=0，表示扫描已启动但尚未宣布完成。
        buildAutoCompressResult(rootPath, {
          batchId,
          totalFilesScanned: 0,
          totalCandidates: 0,
          totalProcessed: 0,
          completedAtMs: 0,
        }),
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

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

    // 初始状态：只有批次元数据，没有任何队列子任务，复合卡片会以“空批次”形式出现。
    let tasks: any[] =
      (vm.compositeBatchCompressTasks && "value" in vm.compositeBatchCompressTasks
        ? vm.compositeBatchCompressTasks.value
        : vm.compositeBatchCompressTasks) ?? [];
    expect(tasks.length).toBe(1);
    expect(tasks[0].batchId).toBe(batchId);
    expect(tasks[0].jobs.length).toBe(0);

    // 模拟后台在扫描结束时发出一次进度快照：仍然 0 个候选，但携带非零 completedAtMs。
    const progress: AutoCompressProgress = {
      rootPath,
      totalFilesScanned: 10,
      totalCandidates: 0,
      totalProcessed: 0,
      batchId,
      completedAtMs: Date.now(),
    };
    emitBatchCompressProgress(progress);
    await nextTick();

    // 修复后的 useBatchCompress 应在“无候选且批次已完成”且队列中没有任何子任务时隐藏空的复合任务卡片。
    tasks =
      (vm.compositeBatchCompressTasks && "value" in vm.compositeBatchCompressTasks
        ? vm.compositeBatchCompressTasks.value
        : vm.compositeBatchCompressTasks) ?? [];
    expect(tasks.length).toBe(0);

    wrapper.unmount();
  });
});
