// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import MainApp from "@/MainApp.vue";
import type { TranscodeJob } from "@/types";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

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

describe("MainApp header progress bar", () => {
  beforeEach(() => {
    // Ensure we run in non-Tauri mode for predictable behaviour in tests.
    delete (window as any).__TAURI__;
    delete (window as any).__TAURI_IPC__;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows header progress only while jobs are processing or paused", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    const processingJob: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/a.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "processing",
      progress: 10,
      logs: [],
    } as any;

    setJobs(vm, [processingJob]);
    await nextTick();

    expect(vm.headerProgressVisible).toBe(true);
    expect(vm.headerProgressFading).toBe(false);

    // When the job completes, the header progress should fade out and then hide.
    vi.useFakeTimers();

    const completedJob: TranscodeJob = {
      ...processingJob,
      status: "completed",
      progress: 100,
    };

    setJobs(vm, [completedJob]);
    await nextTick();

    // Immediately after status change the bar is still visible but starts fading.
    expect(vm.headerProgressVisible).toBe(true);
    expect(vm.headerProgressFading).toBe(true);

    vi.runAllTimers();
    await nextTick();

    expect(vm.headerProgressVisible).toBe(false);
    expect(vm.headerProgressFading).toBe(false);
    expect(vm.headerProgressPercent).toBe(0);

    wrapper.unmount();
  });

  it("does not show header progress when only queued jobs exist", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    const queuedJob: TranscodeJob = {
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
    } as any;

    setJobs(vm, [queuedJob]);
    await nextTick();

    // Queue contributes to aggregated progress but should not keep the header bar visible.
    expect(vm.globalTaskbarProgressPercent).toBe(0);
    expect(vm.headerProgressVisible).toBe(false);
    expect(vm.headerProgressFading).toBe(false);

    wrapper.unmount();
  });
});
