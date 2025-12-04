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
  template: `<div
    data-testid="queue-item-stub"
    :data-view-mode="viewMode"
    :data-progress-style="progressStyle"
  >
    {{ job.filename }}
  </div>`,
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
  >
    {{ batch.batchId }}
  </div>`,
};

function makeJob(id: number): TranscodeJob {
  return {
    id: `job-${id}`,
    filename: `C:/videos/sample-${id}.mp4`,
    type: "video",
    source: "manual",
    originalSizeMB: 10,
    originalCodec: "h264",
    presetId: "p1",
    status: "processing",
    progress: 50,
    logs: [],
  };
}

function getArray(possibleRef: any): any[] {
  if (Array.isArray(possibleRef)) return possibleRef;
  if (possibleRef && Array.isArray(possibleRef.value)) return possibleRef.value;
  return [];
}

describe("MainApp icon queue view", () => {
  it("renders a grid of mini cards for icon view modes", async () => {
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
    if ("queueProgressStyleModel" in vm) {
      vm.queueProgressStyleModel = "card-fill";
    }

    const jobsRef = getArray(vm.jobs);
    if (Array.isArray(vm.jobs)) {
      vm.jobs = [makeJob(1)];
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = [makeJob(1)];
    } else if (Array.isArray(jobsRef)) {
      vm.jobs = [makeJob(1)];
    }

    await nextTick();

    expect(wrapper.find("[data-testid='queue-icon-grid']").exists()).toBe(true);
    const items = wrapper.findAll("[data-testid='queue-icon-item-stub']");
    expect(items.length).toBe(1);
    expect(items[0].attributes("data-size")).toBe("small");

    if ("queueViewModeModel" in vm) {
      vm.queueViewModeModel = "icon-medium";
    }
    await nextTick();
    const mediumItems = wrapper.findAll("[data-testid='queue-icon-item-stub']");
    expect(mediumItems.length).toBe(1);
    expect(mediumItems[0].attributes("data-size")).toBe("medium");

    if ("queueViewModeModel" in vm) {
      vm.queueViewModeModel = "icon-large";
    }
    await nextTick();
    const largeItems = wrapper.findAll("[data-testid='queue-icon-item-stub']");
    expect(largeItems.length).toBe(1);
    expect(largeItems[0].attributes("data-size")).toBe("large");

    wrapper.unmount();
  });

  it("limits the number of rendered icon cards for large queues", async () => {
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
    if ("queueProgressStyleModel" in vm) {
      vm.queueProgressStyleModel = "card-fill";
    }

    const manyJobs: TranscodeJob[] = [];
    for (let i = 0; i < 1000; i += 1) {
      manyJobs.push(makeJob(i));
    }

    if (Array.isArray(vm.jobs)) {
      vm.jobs = manyJobs;
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = manyJobs;
    }

    await nextTick();

    const items = wrapper.findAll("[data-testid='queue-icon-item-stub']");
    expect(items.length).toBeGreaterThan(0);
    // Large queues should not render all cards at once; keep the DOM bounded.
    expect(items.length).toBeLessThanOrEqual(300);

    wrapper.unmount();
  });

  it("renders icon cards for both active and skipped jobs", async () => {
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
    if ("queueProgressStyleModel" in vm) {
      vm.queueProgressStyleModel = "card-fill";
    }

    const jobs: TranscodeJob[] = [
      makeJob(1),
      {
        ...makeJob(2),
        id: "job-skipped",
        filename: "C:/videos/skipped.mp4",
        status: "skipped",
      },
    ];

    if (Array.isArray(vm.jobs)) {
      vm.jobs = jobs;
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = jobs;
    }

    await nextTick();

    const items = wrapper.findAll("[data-testid='queue-icon-item-stub']");
    expect(items.length).toBe(2);
    const texts = items.map((el) => el.text());
    expect(texts.join(" ")).toContain("sample-1.mp4");
    expect(texts.join(" ")).toContain("skipped.mp4");

    wrapper.unmount();
  });
});
