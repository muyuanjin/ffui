// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import MainApp from "@/MainApp.vue";
import en from "@/locales/en";
import type { TranscodeJob } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

const queueItemStub = {
  props: ["job", "preset", "canCancel", "viewMode", "progressStyle"],
  template:
    '<div data-testid="queue-item-stub" @click="$emit(\'inspect\', job)"></div>',
};

const queueIconItemStub = {
  props: ["job", "size", "progressStyle"],
  template: `<div
    data-testid="queue-icon-item-stub"
    :data-size="size"
    :data-progress-style="progressStyle"
  >
    {{ job.filename }}
  </div>`,
};

const queueSmartScanIconBatchStub = {
  props: ["batch", "size", "progressStyle"],
  template: `<div
    data-testid="queue-icon-batch-stub"
    :data-size="size"
    :data-progress-style="progressStyle"
    :data-job-count="batch.jobs.length"
  >
    {{ batch.batchId }}
  </div>`,
};

describe("MainApp Smart Scan composite batches (non-Tauri)", () => {
  it("renders composite Smart Scan cards with expandable children and wires child inspect", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          // Use a lightweight stub for QueueItem so we can easily detect child clicks.
          QueueItem: queueItemStub,
        },
      },
    });

    const vm: any = wrapper.vm;

    // Seed a synthetic Smart Scan batch and corresponding jobs directly,
    // since MainApp only drives real Smart Scan via the Tauri backend.
    const batchId = "mock-batch-1";
    if (typeof vm.applySmartScanBatchMetaSnapshot === "function") {
      vm.applySmartScanBatchMetaSnapshot({
        batchId,
        rootPath: "C:/videos",
        totalFilesScanned: 10,
        totalCandidates: 3,
        totalProcessed: 0,
        startedAtMs: Date.now(),
        completedAtMs: undefined,
      });
    }

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/input-1.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 100,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 10,
        logs: [],
        batchId,
      },
      {
        id: "job-2",
        filename: "C:/videos/input-2.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 80,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
        batchId,
      },
    ];

    if (Array.isArray(vm.jobs)) {
      vm.jobs = jobs;
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = jobs;
    }

    await nextTick();

    const batchCards = wrapper.findAll('[data-testid="smart-scan-batch-card"]');
    expect(batchCards.length).toBeGreaterThan(0);

    const firstCard = batchCards[0];

    // Expand the batch card via the toggle button.
    const toggleButton = firstCard.get("button");
    await toggleButton.trigger("click");
    await nextTick();

    const childrenContainer = firstCard.find(
      '[data-testid="smart-scan-batch-children"]',
    );
    expect(childrenContainer.exists()).toBe(true);

    const childItems = childrenContainer.findAll('[data-testid="queue-item-stub"]');
    expect(childItems.length).toBeGreaterThan(0);

    await childItems[0].trigger("click");
    await nextTick();

    const selected =
      vm.dialogManager && vm.dialogManager.selectedJob
        ? vm.dialogManager.selectedJob.value
        : null;

    expect(selected).toBeTruthy();
    expect(selected.source).toBe("smart_scan");
    expect(selected.batchId, "Smart Scan child jobs should carry a batchId").toBeTruthy();
  });

  it("keeps Smart Scan batches aggregated in icon grid view instead of splitting child jobs", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
          QueueIconItem: queueIconItemStub,
          QueueSmartScanIconBatchItem: queueSmartScanIconBatchStub,
        },
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    if ("queueViewModeModel" in vm) {
      vm.queueViewModeModel = "icon-small";
    }

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/input-1.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 100,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 10,
        logs: [],
        batchId: "batch-1",
      },
      {
        id: "job-2",
        filename: "C:/videos/input-2.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 80,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
        batchId: "batch-1",
      },
    ];

    if (Array.isArray(vm.jobs)) {
      vm.jobs = jobs;
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = jobs;
    }

    await nextTick();

    const grid = wrapper.find("[data-testid='queue-icon-grid']");
    expect(grid.exists()).toBe(true);

    const batchIcons = wrapper.findAll("[data-testid='queue-icon-batch-stub']");
    expect(batchIcons.length).toBe(1);
    expect(batchIcons[0].attributes("data-job-count")).toBe("2");

    // 子任务不会在网格中“散开”为独立卡片。
    const jobIcons = wrapper.findAll("[data-testid='queue-icon-item-stub']");
    expect(jobIcons.length).toBe(0);
  });

  it("hides Smart Scan batch cards once all child jobs are removed from the queue", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
        },
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    const batchId = "batch-delete-1";

    // 先注入一条批次元数据和对应的 Smart Scan 子任务，使得复合任务卡片出现。
    if (typeof vm.applySmartScanBatchMetaSnapshot === "function") {
      vm.applySmartScanBatchMetaSnapshot({
        batchId,
        rootPath: "C:/videos",
        totalFilesScanned: 10,
        totalCandidates: 2,
        totalProcessed: 2,
        startedAtMs: Date.now(),
        completedAtMs: Date.now(),
      });
    }

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/input-1.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 100,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
        batchId,
      } as any,
      {
        id: "job-2",
        filename: "C:/videos/input-2.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 80,
        originalCodec: "h264",
        presetId: "p1",
        status: "failed",
        progress: 100,
        logs: [],
        batchId,
      } as any,
    ];

    if (Array.isArray(vm.jobs)) {
      vm.jobs = jobs;
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = jobs;
    }

    await nextTick();

    // Composite 计算结果中应包含该批次。
    const composite =
      (vm.compositeSmartScanTasks &&
        "value" in vm.compositeSmartScanTasks
        ? vm.compositeSmartScanTasks.value
        : vm.compositeSmartScanTasks) ?? [];
    expect(Array.isArray(composite) ? composite.length : 0).toBeGreaterThan(0);

    // 模拟“从列表中删除”成功后，后端清空了该批次的所有队列任务，但前端仍保留批次元数据。
    if (Array.isArray(vm.jobs)) {
      vm.jobs = [];
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = [];
    }

    await nextTick();

    // 修改后的 useSmartScan 应在没有任何子任务且批次已处理完时隐藏空的复合任务卡片。
    expect(wrapper.findAll('[data-testid=\"smart-scan-batch-card\"]').length).toBe(0);

    wrapper.unmount();
  });
});
