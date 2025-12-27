// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick, defineComponent } from "vue";

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
  // Mirror the real component interface closely so props wiring stays honest.
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
  props: ["job"],
  template: `<div data-testid="queue-icon-item-stub">{{ job.filename }}</div>`,
};

const vListStub = defineComponent({
  props: {
    data: {
      type: Array,
      required: true,
    },
  },
  template: `
    <div>
      <div v-for="(item, index) in data" :key="index">
        <slot :item="item" :index="index" />
      </div>
    </div>
  `,
});

function getArray(possibleRef: any): any[] {
  if (Array.isArray(possibleRef)) return possibleRef;
  if (possibleRef && Array.isArray(possibleRef.value)) return possibleRef.value;
  return [];
}

function setMaybeRef(target: any, key: string, value: any) {
  const current = target[key];
  if (current && typeof current === "object" && "value" in current) {
    current.value = value;
  } else {
    target[key] = value;
  }
}

async function setQueueModeForTests(vm: any, mode: "display" | "queue") {
  if ("queueModeModel" in vm) {
    vm.queueModeModel = mode;
    return;
  }
  if (typeof vm.setQueueMode === "function") {
    await vm.setQueueMode(mode);
    return;
  }
  setMaybeRef(vm, "queueMode", mode);
}

describe("MainApp queue view modes and empty state", () => {
  it("shows empty queue call-to-action when there are no jobs", async () => {
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
    await nextTick();

    const jobs = getArray(vm.jobs);
    expect(jobs.length).toBe(0);

    const text = wrapper.text();
    expect(text).toContain((en as any).app.emptyQueue.title);
    expect(text).toContain((en as any).app.emptyQueue.subtitle);

    expect(wrapper.findAll("[data-testid='queue-item-stub']").length).toBe(0);

    // Changing the queue view mode should not affect the empty state CTA.
    if ("queueViewModeModel" in vm) {
      vm.queueViewModeModel = "compact";
      await nextTick();
      expect(wrapper.findAll("[data-testid='queue-item-stub']").length).toBe(0);
      expect(wrapper.text()).toContain((en as any).app.emptyQueue.title);
    }

    wrapper.unmount();
  });

  it("passes queue row variant and progress style preferences into QueueItem props", async () => {
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

    // Start from a known preference baseline so previous tests or localStorage
    // state do not affect expectations.
    if ("queueViewModeModel" in vm) {
      vm.queueViewModeModel = "detail";
    }
    if ("queueProgressStyleModel" in vm) {
      vm.queueProgressStyleModel = "bar";
    }

    const job: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "processing",
      progress: 50,
      logs: [],
    };

    if (Array.isArray(vm.jobs)) {
      vm.jobs = [job];
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = [job];
    }

    await nextTick();

    let items = wrapper.findAll("[data-testid='queue-item-stub']");
    expect(items.length).toBe(1);

    let first = items[0];
    // Default wiring should reflect the current queue view preferences.
    expect(first.attributes("data-view-mode")).toBe("detail");
    expect(first.attributes("data-progress-style")).toBe("bar");

    // Switching preferences should propagate to child QueueItem props.
    if ("queueViewModeModel" in vm) {
      vm.queueViewModeModel = "compact";
    }
    if ("queueProgressStyleModel" in vm) {
      vm.queueProgressStyleModel = "ripple-card";
    }
    await nextTick();

    items = wrapper.findAll("[data-testid='queue-item-stub']");
    expect(items.length).toBe(1);

    first = items[0];
    expect(first.attributes("data-view-mode")).toBe("compact");
    expect(first.attributes("data-progress-style")).toBe("ripple-card");

    if ("queueViewModeModel" in vm) {
      vm.queueViewModeModel = "mini";
      await nextTick();

      items = wrapper.findAll("[data-testid='queue-item-stub']");
      expect(items.length).toBe(1);
      first = items[0];
      expect(first.attributes("data-view-mode")).toBe("mini");
    }

    wrapper.unmount();
  });

  it("shows both completed and skipped jobs in the queue list view", async () => {
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

    const jobs: TranscodeJob[] = [
      {
        id: "job-visible",
        filename: "C:/videos/visible.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
      },
      {
        id: "job-skipped",
        filename: "C:/videos/skipped.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "skipped",
        progress: 0,
        logs: [],
        skipReason: "already optimized",
      },
    ];

    if (Array.isArray(vm.jobs)) {
      vm.jobs = jobs;
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = jobs;
    }

    await nextTick();

    const items = wrapper.findAll("[data-testid='queue-item-stub']");
    expect(items.length).toBe(2);
    const texts = items.map((el) => el.text());
    expect(texts.join(" ")).toContain("visible.mp4");
    expect(texts.join(" ")).toContain("skipped.mp4");

    wrapper.unmount();
  });

  it("shows processing jobs in queue mode icon view even when status filters hide them", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
          QueueIconItem: queueIconItemStub,
        },
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    const previousQueueMode = "queueModeModel" in vm ? vm.queueModeModel : null;
    const previousViewMode = "queueViewModeModel" in vm ? vm.queueViewModeModel : null;

    await setQueueModeForTests(vm, "queue");
    if ("queueViewModeModel" in vm) {
      vm.queueViewModeModel = "icon-small";
    }

    const jobs: TranscodeJob[] = [
      {
        id: "job-processing",
        filename: "C:/videos/processing.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 10,
        logs: [],
      },
      {
        id: "job-queued",
        filename: "C:/videos/queued.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
      },
    ];

    setMaybeRef(vm, "jobs", jobs);
    // Hide processing via status filters; queue mode must still surface processing group/items.
    if (typeof vm.toggleStatusFilter === "function") {
      vm.toggleStatusFilter("queued");
    } else {
      setMaybeRef(vm, "activeStatusFilters", new Set(["queued"]));
    }

    await nextTick();

    const items = wrapper.findAll("[data-testid='queue-icon-item-stub']");
    const text = items.map((el) => el.text()).join(" ");
    expect(text).toContain("processing.mp4");
    expect(text).toContain("queued.mp4");

    // Restore persisted preferences so other tests remain isolated.
    if (previousQueueMode) {
      await setQueueModeForTests(vm, previousQueueMode);
    }
    if (previousViewMode && "queueViewModeModel" in vm) {
      vm.queueViewModeModel = previousViewMode;
    }
    await nextTick();

    wrapper.unmount();
  });

  it("defaults queue mode to display-only and persists independently from view mode", async () => {
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
    await nextTick();

    const currentMode = "queueModeModel" in vm ? vm.queueModeModel : vm.queueMode;
    expect(currentMode).toBe("display");

    await setQueueModeForTests(vm, "queue");
    await nextTick();

    const updatedMode = "queueModeModel" in vm ? vm.queueModeModel : vm.queueMode;
    expect(updatedMode).toBe("queue");

    // Changing view mode should not implicitly reset queue mode.
    vm.queueViewModeModel = "compact";
    await nextTick();
    const modeAfterViewChange = "queueModeModel" in vm ? vm.queueModeModel : vm.queueMode;
    expect(modeAfterViewChange).toBe("queue");

    wrapper.unmount();
  });

  it("groups manual jobs into Processing and Waiting sections in queue mode", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
          VList: vListStub,
        },
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";
    await nextTick();

    await setQueueModeForTests(vm, "queue");
    if ("queueViewModeModel" in vm) {
      vm.queueViewModeModel = "detail";
    }
    if ("queueProgressStyleModel" in vm) {
      vm.queueProgressStyleModel = "bar";
    }

    const jobs: TranscodeJob[] = [
      {
        id: "job-processing",
        filename: "C:/videos/processing.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 30,
        logs: [],
      },
      {
        id: "job-waiting",
        filename: "C:/videos/waiting.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 5,
        originalCodec: "h264",
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
      },
      {
        id: "job-completed",
        filename: "C:/videos/completed.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 8,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
      },
    ];

    if (Array.isArray(vm.jobs)) {
      vm.jobs = jobs;
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = jobs;
    }

    await nextTick();
    await nextTick();

    const queuePanelProps =
      vm.queuePanelProps && "value" in vm.queuePanelProps ? vm.queuePanelProps.value : vm.queuePanelProps;
    expect(queuePanelProps.queueMode).toBe("queue");
    expect(queuePanelProps.queueModeProcessingJobs.length).toBe(1);
    expect(queuePanelProps.queueModeWaitingItems.length).toBe(1);

    const items = wrapper.findAll("[data-testid='queue-item-stub']");
    expect(items.length).toBe(3);
    // First rendered stub should belong to the processing job, followed by waiting.
    expect(items[0].text()).toContain("processing.mp4");
    expect(items[1].text()).toContain("waiting.mp4");

    wrapper.unmount();
  });
});
