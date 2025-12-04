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

function getArray(possibleRef: any): any[] {
  if (Array.isArray(possibleRef)) return possibleRef;
  if (possibleRef && Array.isArray(possibleRef.value)) return possibleRef.value;
  return [];
}

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

    const presets = getArray(vm.presets);
    const presetId = presets[0]?.id ?? "p1";

    const config = {
      minImageSizeKB: 10,
      minVideoSizeMB: 10,
      minSavingRatio: 0.8,
      imageTargetFormat: "avif" as const,
      videoPresetId: presetId,
    };

    // runSmartScan uses the mock implementation in non-Tauri environments.
    vm.runSmartScan(config);
    await nextTick();
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

    const selectedRef = vm.selectedJobForDetail;
    const selected =
      selectedRef && "value" in selectedRef ? selectedRef.value : selectedRef;

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
});
