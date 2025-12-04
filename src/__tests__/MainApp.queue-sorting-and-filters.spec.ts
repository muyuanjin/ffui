import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import MainApp from "@/MainApp.vue";
import en from "@/locales/en";
import type { TranscodeJob, JobStatus } from "@/types";

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
    :data-job-id="job.id"
  >
    {{ job.filename }}
  </div>`,
};

function setJobs(vm: any, jobs: TranscodeJob[]) {
  if (Array.isArray(vm.jobs)) {
    vm.jobs = jobs;
  } else if (vm.jobs && "value" in vm.jobs) {
    vm.jobs.value = jobs;
  }
}

function getFilteredJobs(vm: any): TranscodeJob[] {
  const value = (vm as any).filteredJobs;
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.value)) return value.value;
  return [];
}

describe("MainApp queue sorting and filtering", () => {
  it("sorts display mode jobs by configured primary field and direction", async () => {
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

    // Explicitly use display mode so queue ordering is purely visual.
    if ("queueModeModel" in vm) {
      vm.queueModeModel = "display";
    }

    const jobs: TranscodeJob[] = [
      {
        id: "job-b",
        filename: "C:/videos/beta.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
      },
      {
        id: "job-a",
        filename: "C:/videos/alpha.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
      },
      {
        id: "job-c",
        filename: "C:/videos/charlie.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
      },
    ];

    setJobs(vm, jobs);

    if ("sortPrimary" in vm) {
      vm.sortPrimary = "filename";
    }
    if ("sortPrimaryDirection" in vm) {
      vm.sortPrimaryDirection = "asc";
    }

    await nextTick();

    const ascItems = wrapper.findAll("[data-testid='queue-item-stub']");
    const ascOrder = ascItems.map((el) => el.attributes("data-job-id"));
    expect(ascOrder).toEqual(["job-a", "job-b", "job-c"]);

    if ("sortPrimaryDirection" in vm) {
      vm.sortPrimaryDirection = "desc";
    }
    await nextTick();

    const descItems = wrapper.findAll("[data-testid='queue-item-stub']");
    const descOrder = descItems.map((el) => el.attributes("data-job-id"));
    expect(descOrder).toEqual(["job-c", "job-b", "job-a"]);

    wrapper.unmount();
  });

  it("sorts waiting group in queue mode by queueOrder then configured fields", async () => {
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

    if ("queueModeModel" in vm) {
      vm.queueModeModel = "queue";
    }
    if ("sortPrimary" in vm) {
      vm.sortPrimary = "filename";
    }
    if ("sortPrimaryDirection" in vm) {
      vm.sortPrimaryDirection = "asc";
    }

    const jobs: TranscodeJob[] = [
      {
        id: "job-last",
        filename: "C:/videos/zeta.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
        queueOrder: 2,
      },
      {
        id: "job-alpha",
        filename: "C:/videos/alpha.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
        queueOrder: 1,
      },
      {
        id: "job-beta",
        filename: "C:/videos/beta.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
        queueOrder: 1,
      },
    ];

    setJobs(vm, jobs);
    await nextTick();

    const waiting: TranscodeJob[] = (vm as any).queueModeWaitingJobs ?? [];
    const ids = waiting.map((job) => job.id);
    // queueOrder 1 group first, internally sorted by filename, then queueOrder 2.
    expect(ids).toEqual(["job-alpha", "job-beta", "job-last"]);

    wrapper.unmount();
  });

  it("supports extended sort fields and secondary sort configuration", async () => {
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

    if ("queueModeModel" in vm) {
      vm.queueModeModel = "display";
    }

    const jobs: TranscodeJob[] = [
      {
        id: "job-short",
        filename: "C:/videos/alpha-short.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 5,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
        mediaInfo: {
          durationSeconds: 60,
          sizeMB: 5,
        },
      },
      {
        id: "job-long",
        filename: "C:/videos/beta-long.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 20,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
        mediaInfo: {
          durationSeconds: 600,
          sizeMB: 20,
        },
      },
    ];

    setJobs(vm, jobs);

    if ("sortPrimary" in vm) {
      vm.sortPrimary = "duration";
    }
    if ("sortPrimaryDirection" in vm) {
      vm.sortPrimaryDirection = "asc";
    }
    if ("sortSecondary" in vm) {
      vm.sortSecondary = "filename";
    }
    if ("sortSecondaryDirection" in vm) {
      vm.sortSecondaryDirection = "asc";
    }

    await nextTick();

    let items = wrapper.findAll("[data-testid='queue-item-stub']");
    let order = items.map((el) => el.attributes("data-job-id"));
    expect(order).toEqual(["job-short", "job-long"]);

    // Flip primary direction and ensure ordering reverses.
    if ("sortPrimaryDirection" in vm) {
      vm.sortPrimaryDirection = "desc";
    }
    await nextTick();

    items = wrapper.findAll("[data-testid='queue-item-stub']");
    order = items.map((el) => el.attributes("data-job-id"));
    expect(order).toEqual(["job-long", "job-short"]);

    wrapper.unmount();
  });

  it("filters by status and type in the queue", async () => {
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
        id: "job-processing",
        filename: "C:/videos/processing.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 50,
        logs: [],
      },
      {
        id: "job-waiting-manual",
        filename: "C:/videos/waiting-manual.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 8,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
      },
      {
        id: "job-waiting-smart",
        filename: "C:/videos/waiting-smart.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 12,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
      },
    ];

    setJobs(vm, jobs);
    await nextTick();

    // No filters: all jobs visible.
    let filtered = getFilteredJobs(vm);
    expect(filtered.map((j) => j.id).sort()).toEqual(
      ["job-processing", "job-waiting-manual", "job-waiting-smart"].sort(),
    );

    // Filter by status: only waiting jobs should remain.
    if (typeof vm.toggleStatusFilter === "function") {
      vm.toggleStatusFilter("waiting" as JobStatus);
    }
    await nextTick();

    filtered = getFilteredJobs(vm);
    expect(filtered.map((j) => j.id).sort()).toEqual(
      ["job-waiting-manual", "job-waiting-smart"].sort(),
    );

    // Further filter by type: keep only manual waiting jobs.
    if (typeof vm.toggleTypeFilter === "function") {
      vm.toggleTypeFilter("manual");
    }
    await nextTick();

    filtered = getFilteredJobs(vm);
    expect(filtered.map((j) => j.id)).toEqual(["job-waiting-manual"]);

    wrapper.unmount();
  });

  it("supports text and regex filters with a safe fallback on invalid patterns", async () => {
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
        id: "job-sample",
        filename: "C:/videos/sample-video.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
      },
      {
        id: "job-other",
        filename: "C:/videos/other.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
      },
    ];

    setJobs(vm, jobs);
    await nextTick();

    // Start with a valid regex filter.
    vm.filterText = "sample";
    vm.filterUseRegex = true;
    await nextTick();

    let filtered = getFilteredJobs(vm);
    const initialIds = filtered.map((j) => j.id);
    expect(initialIds).toEqual(["job-sample"]);

    // Enter an invalid regex; the component should surface an error but
    // keep using the last valid regex to avoid dropping all rows.
    vm.filterText = "[unbalanced";
    await nextTick();

    expect(vm.filterRegexError).toBeTruthy();
    filtered = getFilteredJobs(vm);
    const afterInvalidIds = filtered.map((j) => j.id);
    expect(afterInvalidIds).toEqual(initialIds);

    wrapper.unmount();
  });

  it("parses combined text and size tokens in the filter input", async () => {
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
        id: "job-small-sample",
        filename: "C:/videos/sample-small.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 5,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
        mediaInfo: {
          durationSeconds: 60,
          sizeMB: 5,
        },
      },
      {
        id: "job-big-sample",
        filename: "C:/videos/sample-big.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 25,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
        mediaInfo: {
          durationSeconds: 600,
          sizeMB: 25,
        },
      },
      {
        id: "job-big-other",
        filename: "C:/videos/other-big.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 30,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
        mediaInfo: {
          durationSeconds: 600,
          sizeMB: 30,
        },
      },
    ];

    setJobs(vm, jobs);
    await nextTick();

    // size>10mb AND "sample" in path → 只保留体积大于 10MB 且名称包含 sample 的任务。
    vm.filterUseRegex = false;
    vm.filterText = "sample size>10mb";
    await nextTick();

    const filtered = getFilteredJobs(vm);
    const ids = filtered.map((j) => j.id);
    expect(ids).toEqual(["job-big-sample"]);

    wrapper.unmount();
  });
});
