// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import MainApp from "@/MainApp.vue";
import type { AppSettings, TranscodeJob } from "@/types";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import { buildSmartScanDefaults } from "./helpers/smartScanDefaults";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

function setJobs(vm: any, jobs: TranscodeJob[]) {
  if (Array.isArray(vm.jobs)) {
    vm.jobs = jobs;
  } else if (vm.jobs && "value" in vm.jobs) {
    vm.jobs.value = jobs;
  }
}

describe("MainApp global aggregated progress", () => {
  it("keeps aggregated progress monotonic when a job completes (bySize mode)", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    // Inject settings so the frontend uses bySize weighting, matching the
    // backend TaskbarProgressMode::BySize behaviour.
    const settings: AppSettings = {
      tools: {
        ffmpegPath: undefined,
        ffprobePath: undefined,
        avifencPath: undefined,
        autoDownload: false,
        autoUpdate: false,
        downloaded: undefined,
      },
      smartScanDefaults: buildSmartScanDefaults(),
      previewCapturePercent: 25,
      defaultQueuePresetId: undefined,
      maxParallelJobs: undefined,
      taskbarProgressMode: "bySize",
    };

    vm.appSettings = settings;

    const job1: TranscodeJob = {
      id: "1",
      filename: "small-heavy.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 1,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "processing",
      progress: 80,
      logs: [],
      estimatedSeconds: 10,
    };

    const job2: TranscodeJob = {
      id: "2",
      filename: "large-light.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 9,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "processing",
      progress: 20,
      logs: [],
      estimatedSeconds: 10,
    };

    setJobs(vm, [job1, job2]);
    await nextTick();

    const before: number = vm.globalTaskbarProgressPercent;

    // Mark the first job as completed; aggregated progress should not go down.
    const completedJob1: TranscodeJob = {
      ...job1,
      status: "completed",
      progress: 100,
    };

    setJobs(vm, [completedJob1, job2]);
    await nextTick();

    const after: number = vm.globalTaskbarProgressPercent;

    expect(after).toBeGreaterThanOrEqual(before);

    wrapper.unmount();
  });

  it("ignores completed jobs when scope is activeAndQueued and non-terminal jobs exist", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    const settings: AppSettings = {
      tools: {
        ffmpegPath: undefined,
        ffprobePath: undefined,
        avifencPath: undefined,
        autoDownload: false,
        autoUpdate: false,
        downloaded: undefined,
      },
      smartScanDefaults: buildSmartScanDefaults(),
      previewCapturePercent: 25,
      defaultQueuePresetId: undefined,
      maxParallelJobs: undefined,
      taskbarProgressMode: "bySize",
      taskbarProgressScope: "activeAndQueued",
    };

    vm.appSettings = settings;

    const completedJob: TranscodeJob = {
      id: "1",
      filename: "done.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      estimatedSeconds: 10,
      startTime: 1000,
    };

    const waitingJob: TranscodeJob = {
      id: "2",
      filename: "new.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "waiting",
      progress: 0,
      logs: [],
      estimatedSeconds: 10,
      startTime: 1000,
    };

    setJobs(vm, [completedJob, waitingJob]);
    await nextTick();

    // Terminal jobs from the same enqueue cohort should be counted so serial
    // queues do not reset progress to 0% between tasks.
    expect(vm.globalTaskbarProgressPercent).toBeCloseTo(50, 6);

    wrapper.unmount();
  });

  it("ignores completed jobs from a previous cohort when scope is activeAndQueued", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    const settings: AppSettings = {
      tools: {
        ffmpegPath: undefined,
        ffprobePath: undefined,
        avifencPath: undefined,
        autoDownload: false,
        autoUpdate: false,
        downloaded: undefined,
      },
      smartScanDefaults: buildSmartScanDefaults(),
      previewCapturePercent: 25,
      defaultQueuePresetId: undefined,
      maxParallelJobs: undefined,
      taskbarProgressMode: "bySize",
      taskbarProgressScope: "activeAndQueued",
    };

    vm.appSettings = settings;

    const completedOld: TranscodeJob = {
      id: "old",
      filename: "old.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      estimatedSeconds: 10,
      startTime: 1000,
    };

    const waitingNew: TranscodeJob = {
      id: "new",
      filename: "new.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "waiting",
      progress: 0,
      logs: [],
      estimatedSeconds: 10,
      startTime: 2000,
    };

    setJobs(vm, [completedOld, waitingNew]);
    await nextTick();

    expect(vm.globalTaskbarProgressPercent).toBe(0);

    wrapper.unmount();
  });
});
