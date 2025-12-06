// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import MainApp from "@/MainApp.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { TranscodeJob } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const queueItemStub = {
  props: ["job", "preset", "canCancel", "viewMode", "progressStyle"],
  template: `<div data-testid="queue-item-stub" :data-job-id="job.id">{{ job.filename }}</div>`,
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

describe("MainApp queue sorting basics", () => {
  it("sorts display mode jobs by configured primary field and direction", async () => {
    const wrapper = mount(MainApp, {
      global: { plugins: [i18n], stubs: { QueueItem: queueItemStub } },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";
    if ("queueModeModel" in vm) vm.queueModeModel = "display";

    const jobs: TranscodeJob[] = [
      { id: "job-b", filename: "C:/videos/beta.mp4", type: "video", source: "manual", originalSizeMB: 10, originalCodec: "h264", presetId: "p1", status: "waiting", progress: 0, logs: [] },
      { id: "job-a", filename: "C:/videos/alpha.mp4", type: "video", source: "manual", originalSizeMB: 10, originalCodec: "h264", presetId: "p1", status: "waiting", progress: 0, logs: [] },
      { id: "job-c", filename: "C:/videos/charlie.mp4", type: "video", source: "manual", originalSizeMB: 10, originalCodec: "h264", presetId: "p1", status: "waiting", progress: 0, logs: [] },
    ];

    setJobs(vm, jobs);
    if ("sortPrimary" in vm) vm.sortPrimary = "filename";
    if ("sortPrimaryDirection" in vm) vm.sortPrimaryDirection = "asc";
    await nextTick();

    const ascOrder = wrapper.findAll("[data-testid='queue-item-stub']").map((el) => el.attributes("data-job-id"));
    expect(ascOrder).toEqual(["job-a", "job-b", "job-c"]);

    if ("sortPrimaryDirection" in vm) vm.sortPrimaryDirection = "desc";
    await nextTick();
    const descOrder = wrapper.findAll("[data-testid='queue-item-stub']").map((el) => el.attributes("data-job-id"));
    expect(descOrder).toEqual(["job-c", "job-b", "job-a"]);
  });

  it("sorts waiting group in queue mode by queueOrder then configured fields", async () => {
    const wrapper = mount(MainApp, {
      global: { plugins: [i18n], stubs: { QueueItem: queueItemStub } },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";
    if ("queueModeModel" in vm) vm.queueModeModel = "queue";

    const jobs: TranscodeJob[] = [
      { id: "job-1", filename: "C:/videos/beta.mp4", queueOrder: 2, type: "video", source: "manual", originalSizeMB: 10, originalCodec: "h264", presetId: "p1", status: "waiting", progress: 0, logs: [] } as any,
      { id: "job-2", filename: "C:/videos/alpha.mp4", queueOrder: 1, type: "video", source: "manual", originalSizeMB: 10, originalCodec: "h264", presetId: "p1", status: "waiting", progress: 0, logs: [] } as any,
      { id: "job-3", filename: "C:/videos/charlie.mp4", queueOrder: 3, type: "video", source: "manual", originalSizeMB: 10, originalCodec: "h264", presetId: "p1", status: "waiting", progress: 0, logs: [] } as any,
    ];

    setJobs(vm, jobs);
    if ("sortPrimary" in vm) vm.sortPrimary = "filename";
    if ("sortPrimaryDirection" in vm) vm.sortPrimaryDirection = "asc";
    await nextTick();

    const waitingGroup = getFilteredJobs(vm).filter((job) => job.status === "waiting");
    expect(waitingGroup.map((j) => j.id)).toEqual(["job-2", "job-1", "job-3"]);
  });

  it("supports extended sort fields and secondary sort configuration", async () => {
    const wrapper = mount(MainApp, {
      global: { plugins: [i18n], stubs: { QueueItem: queueItemStub } },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";
    if ("queueModeModel" in vm) vm.queueModeModel = "display";

    const jobs: TranscodeJob[] = [
      { id: "job-1", filename: "C:/videos/a.mp4", type: "video", source: "manual", originalSizeMB: 20, originalCodec: "h264", presetId: "p1", status: "completed", progress: 100, durationSeconds: 100, modifiedTime: 1, createdTime: 10, logs: [] } as any,
      { id: "job-2", filename: "C:/videos/b.mp4", type: "video", source: "manual", originalSizeMB: 15, originalCodec: "h264", presetId: "p1", status: "completed", progress: 100, durationSeconds: 80, modifiedTime: 2, createdTime: 5, logs: [] } as any,
      { id: "job-3", filename: "C:/videos/c.mp4", type: "video", source: "manual", originalSizeMB: 15, originalCodec: "h264", presetId: "p1", status: "completed", progress: 100, durationSeconds: 80, modifiedTime: 3, createdTime: 7, logs: [] } as any,
    ];

    setJobs(vm, jobs);
    if ("sortPrimary" in vm) vm.sortPrimary = "inputSize";
    if ("sortPrimaryDirection" in vm) vm.sortPrimaryDirection = "asc";
    if ("sortSecondary" in vm) vm.sortSecondary = "modifiedTime";
    if ("sortSecondaryDirection" in vm) vm.sortSecondaryDirection = "desc";
    await nextTick();

    const ordered = wrapper.findAll("[data-testid='queue-item-stub']").map((el) => el.attributes("data-job-id"));
    expect(ordered).toEqual(["job-2", "job-3", "job-1"]);
  });
});
