// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { nextTick } from "vue";
import {
  defaultAppSettings,
  emitQueueState,
  getQueueJobs,
  i18n,
  setQueueJobs,
  useBackendMock,
} from "./helpers/mainAppTauriDialog";
import { mount } from "@vue/test-utils";
import MainApp from "@/MainApp.vue";
import type { TranscodeJob } from "@/types";

describe("MainApp queue event handling", () => {
  it("subscribes to queue-state stream and updates progress from events", async () => {
    const jobId = "job-stream-1";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/progress.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 100,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "processing",
        progress: 0,
        logs: [],
      },
    ] as TranscodeJob[]);

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

    await nextTick();
    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    const jobsBefore = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(jobsBefore.length).toBe(1);
    expect(jobsBefore[0].progress).toBe(0);

    setQueueJobs([
      {
        ...getQueueJobs()[0],
        progress: 65,
      },
    ]);
    emitQueueState(getQueueJobs());
    await nextTick();

    const jobsAfter = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(jobsAfter.length).toBe(1);
    expect(jobsAfter[0].progress).toBe(65);

    wrapper.unmount();
  });

  it("performs a safety refresh when processing jobs stay at 0% for a while", async () => {
    vi.useFakeTimers();

    const jobId = "job-stuck-0";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/stuck.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 100,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "processing",
        progress: 0,
        logs: [],
      },
    ] as TranscodeJob[]);

    let getQueueStateCalls = 0;

    useBackendMock({
      get_queue_state: () => {
        getQueueStateCalls += 1;
        return { jobs: getQueueJobs() };
      },
      get_queue_state_lite: () => {
        getQueueStateCalls += 1;
        return { jobs: getQueueJobs() };
      },
      get_app_settings: () => defaultAppSettings(),
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

    await nextTick();
    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    const initialCalls = getQueueStateCalls;
    expect(initialCalls).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(9000);

    expect(getQueueStateCalls).toBeGreaterThan(initialCalls);

    wrapper.unmount();
    vi.useRealTimers();
  });
});
