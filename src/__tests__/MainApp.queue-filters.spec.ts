// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import MainApp from "@/MainApp.vue";
import en from "@/locales/en";
import type { TranscodeJob, JobStatus } from "@/types";

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: en as any } });

const queueItemStub = {
  props: ["job", "preset", "canCancel", "viewMode", "progressStyle"],
  template: `<div data-testid="queue-item-stub" :data-job-id="job.id">{{ job.filename }}</div>`,
};

function setJobs(vm: any, jobs: TranscodeJob[]) {
  if (Array.isArray(vm.jobs)) vm.jobs = jobs;
  else if (vm.jobs && "value" in vm.jobs) vm.jobs.value = jobs;
}

function getFilteredJobs(vm: any): TranscodeJob[] {
  const value = (vm as any).filteredJobs;
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.value)) return value.value;
  return [];
}

describe("MainApp queue filters", () => {
  it("filters by status and type in the queue", async () => {
    const wrapper = mount(MainApp, {
      global: { plugins: [i18n], stubs: { QueueItem: queueItemStub } },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";
    if ("queueModeModel" in vm) vm.queueModeModel = "display";

    const jobs: TranscodeJob[] = [
      { id: "job-wait", filename: "wait.mp4", type: "video", source: "manual", originalSizeMB: 10, originalCodec: "h264", presetId: "p1", status: "waiting", progress: 0, logs: [] },
      { id: "job-process", filename: "process.mp4", type: "video", source: "manual", originalSizeMB: 10, originalCodec: "h264", presetId: "p1", status: "processing", progress: 10, logs: [] },
      { id: "job-scan", filename: "scan.mp4", type: "video", source: "smart_scan", originalSizeMB: 10, originalCodec: "h264", presetId: "p1", status: "completed", progress: 100, logs: [] },
    ];

    setJobs(vm, jobs);
    if ("activeStatusFilters" in vm) vm.activeStatusFilters = new Set<JobStatus>(["waiting"]);
    if ("activeTypeFilters" in vm) vm.activeTypeFilters = new Set(["manual"]);
    await nextTick();

    const filtered = getFilteredJobs(vm);
    expect(filtered.map((j) => j.id)).toEqual(["job-wait"]);
  });

  it("supports text and regex filters with a safe fallback on invalid patterns", async () => {
    const wrapper = mount(MainApp, {
      global: { plugins: [i18n], stubs: { QueueItem: queueItemStub } },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";
    if ("queueModeModel" in vm) vm.queueModeModel = "display";

    const jobs: TranscodeJob[] = [
      { id: "job-1", filename: "movie-1080p.mp4", type: "video", source: "manual", originalSizeMB: 10, originalCodec: "h264", presetId: "p1", status: "waiting", progress: 0, logs: [] },
      { id: "job-2", filename: "movie-4k.mkv", type: "video", source: "manual", originalSizeMB: 10, originalCodec: "h264", presetId: "p1", status: "waiting", progress: 0, logs: [] },
    ];

    setJobs(vm, jobs);
    if ("filterText" in vm) vm.filterText = "4k";
    await nextTick();
    expect(getFilteredJobs(vm).map((j) => j.id)).toEqual(["job-2"]);

    if ("filterUseRegex" in vm) vm.filterUseRegex = true;
    if ("filterText" in vm) vm.filterText = "movie-(\\d+)";
    await nextTick();
    expect(getFilteredJobs(vm).length).toBe(2);

    if ("filterText" in vm) vm.filterText = "movie-[";
    await nextTick();
    expect(getFilteredJobs(vm).length).toBe(2);
  });

  it("parses combined text and size tokens in the filter input", async () => {
    const wrapper = mount(MainApp, {
      global: { plugins: [i18n], stubs: { QueueItem: queueItemStub } },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";
    if ("queueModeModel" in vm) vm.queueModeModel = "display";

    const jobs: TranscodeJob[] = [
      { id: "job-small", filename: "clip-small.mp4", type: "video", source: "manual", originalSizeMB: 5, originalCodec: "h264", presetId: "p1", status: "waiting", progress: 0, logs: [] },
      { id: "job-big", filename: "clip-big.mp4", type: "video", source: "manual", originalSizeMB: 500, originalCodec: "h264", presetId: "p1", status: "waiting", progress: 0, logs: [] },
    ];

    setJobs(vm, jobs);
    if ("filterText" in vm) vm.filterText = "size>100 big";
    await nextTick();

    const filtered = getFilteredJobs(vm);
    expect(filtered.map((j) => j.id)).toEqual(["job-big"]);
  });

  it("supports unified text filters with regex: tokens combined with size and text", async () => {
    const wrapper = mount(MainApp, {
      global: { plugins: [i18n], stubs: { QueueItem: queueItemStub } },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";
    if ("queueModeModel" in vm) vm.queueModeModel = "display";

    const jobs: TranscodeJob[] = [
      {
        id: "job-small-building",
        filename: "C:/videos/building-small.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
      } as any,
      {
        id: "job-big-building",
        filename: "C:/videos/great-building.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 500,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
      } as any,
      {
        id: "job-big-other",
        filename: "C:/videos/other.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 500,
        originalCodec: "h264",
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
      } as any,
    ];

    setJobs(vm, jobs);
    if ("filterText" in vm)
      vm.filterText = "building size>100 regex:.*building.*";
    await nextTick();

    const filtered = getFilteredJobs(vm);
    expect(filtered.map((j) => j.id)).toEqual(["job-big-building"]);
  });
});
