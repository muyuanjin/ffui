// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { nextTick } from "vue";
import {
  buildAutoCompressResult,
  defaultAppSettings,
  dialogOpenMock,
  emitQueueState,
  emitSmartScanProgress,
  getSmartScanProgressHandler,
  getQueueJobs,
  i18n,
  invokeMock,
  setQueueJobs,
  useBackendMock,
} from "./helpers/mainAppTauriDialog";
import { mount } from "@vue/test-utils";
import MainApp from "@/MainApp.vue";
import type { AutoCompressProgress, TranscodeJob } from "@/types";

// SmartScanWizard 使用 reka-ui Slider，会依赖 ResizeObserver。
// 在 jsdom 测试环境中手动提供一个最小的 polyfill，避免挂载时报错。
if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe("MainApp Smart Scan integration", () => {
  it("opens Smart Scan wizard directly without directory dialog", async () => {
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
    expect(vm.showSmartScan).toBe(false);

    await vm.startSmartScan();
    await nextTick();

    // 不再调用文件夹选择对话框
    expect(dialogOpenMock).not.toHaveBeenCalled();

    // 直接打开批量压缩面板
    expect(vm.showSmartScan).toBe(true);
    expect(vm.activeTab).toBe("queue");

    wrapper.unmount();
  });

  it("pre-fills rootPath from lastDroppedRoot when opening Smart Scan wizard", async () => {
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

    await vm.startSmartScan();
    await nextTick();

    // 面板打开，且配置中预填充了路径
    // smartConfig 是一个 ref，需要访问其 value
    expect(vm.showSmartScan).toBe(true);
    expect(vm.smartConfig?.rootPath ?? vm.smartConfig).toBeTruthy();

    wrapper.unmount();
  });

  it("subscribes to Smart Scan progress events and updates batch metadata", async () => {
    useBackendMock({
      get_queue_state: () => ({ jobs: [] }),
      get_app_settings: () => defaultAppSettings(),
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

    await nextTick();

    expect(typeof getSmartScanProgressHandler()).toBe("function");

    const progress: AutoCompressProgress = {
      rootPath: "C:/videos/batch",
      totalFilesScanned: 10,
      totalCandidates: 4,
      totalProcessed: 2,
      batchId: "auto-compress-test-batch",
    };

    emitSmartScanProgress(progress);
    await nextTick();

    const meta = vm.smartScanBatchMeta["auto-compress-test-batch"];
    expect(meta).toBeTruthy();
    expect(meta.rootPath).toBe("C:/videos/batch");
    expect(meta.totalFilesScanned).toBe(10);
    expect(meta.totalCandidates).toBe(4);
    expect(meta.totalProcessed).toBe(2);

    wrapper.unmount();
  });

  it("creates Smart Scan batch cards from Tauri batch metadata and queue events", async () => {
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
    const vm: any = wrapper.vm;

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

    await vm.runSmartScan(config);
    await nextTick();

    expect(vm.smartScanBatchMeta[batchId]).toBeTruthy();

    let batchCards = wrapper.findAll("[data-testid='smart-scan-batch-card']");
    expect(batchCards.length).toBe(1);

    const job: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/input1.mp4",
      type: "video",
      source: "smart_scan",
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

    const progress: AutoCompressProgress = {
      rootPath,
      totalFilesScanned: 1,
      totalCandidates: 1,
      totalProcessed: 1,
      batchId,
    };
    emitSmartScanProgress(progress);
    await nextTick();

    batchCards = wrapper.findAll("[data-testid='smart-scan-batch-card']");
    expect(batchCards.length).toBe(1);

    const text = batchCards[0].text();
    expect(text).toContain("1 / 1");

    wrapper.unmount();
  });

  it("renders all Smart Scan children immediately when queue snapshot arrives", async () => {
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

    await vm.runSmartScan(config);
    await nextTick();

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/bulk1.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        logs: [],
        batchId,
      } as any,
      {
        id: "job-2",
        filename: "C:/videos/bulk2.mkv",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 15,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        logs: [],
        batchId,
      } as any,
    ];

    setQueueJobs(jobs);
    emitQueueState(getQueueJobs());
    await nextTick();

    let tasks: any[] = vm.compositeSmartScanTasks;
    expect(tasks.length).toBe(1);
    expect(tasks[0].jobs.length).toBe(2);
    expect(tasks[0].totalCount).toBe(2);

    emitSmartScanProgress({
      rootPath,
      totalFilesScanned: 2,
      totalCandidates: 2,
      totalProcessed: 0,
      batchId,
    });
    await nextTick();

    tasks = vm.compositeSmartScanTasks;
    expect(tasks[0].totalCandidates).toBe(2);

    wrapper.unmount();
  });

  it("refreshes queue snapshot from backend when Smart Scan progress arrives without a queue event", async () => {
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

    await vm.runSmartScan(config);
    await nextTick();

    const callsBefore = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "get_queue_state_lite",
    ).length;

    const job: TranscodeJob = {
      id: "job-progress-1",
      filename: "C:/videos/progress-refresh.mp4",
      type: "video",
      source: "smart_scan",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "waiting",
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
    emitSmartScanProgress(progress);

    await nextTick();
    await nextTick();

    const callsAfter = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "get_queue_state_lite",
    ).length;
    expect(callsAfter).toBeGreaterThan(callsBefore);

    wrapper.unmount();
  });
});
