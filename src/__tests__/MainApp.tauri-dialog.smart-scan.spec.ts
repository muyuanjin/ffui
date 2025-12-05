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
  setQueueJobs,
  useBackendMock,
} from "./helpers/mainAppTauriDialog";
import { mount } from "@vue/test-utils";
import MainApp from "@/MainApp.vue";
import type { AutoCompressProgress, TranscodeJob } from "@/types";

describe("MainApp Smart Scan integration", () => {
  it("uses a directory dialog to choose Smart Scan root in Tauri mode", async () => {
    const selectedRoot = "C:/videos/batch";
    dialogOpenMock.mockResolvedValueOnce(selectedRoot);

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

    expect(dialogOpenMock).toHaveBeenCalledTimes(1);
    const [options] = dialogOpenMock.mock.calls[0];
    expect(options).toMatchObject({ multiple: false, directory: true });

    expect(vm.lastDroppedRoot).toBe(selectedRoot);
    expect(vm.showSmartScan).toBe(true);
    expect(vm.activeTab).toBe("queue");

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
      minImageSizeKB: 10,
      minVideoSizeMB: 10,
      minSavingRatio: 0.8,
      imageTargetFormat: "avif" as const,
      videoPresetId: "",
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
});
