// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { ref, defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useJobTimeDisplay } from "./useJobTimeDisplay";
import type { TranscodeJob } from "@/types";

describe("useJobTimeDisplay", () => {
  it("derives elapsed and total time from elapsedMs without inflating by media duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const job = ref<TranscodeJob>({
      id: "job-wall-clock",
      filename: "video.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "processing",
      progress: 50,
      startTime: Date.now() - 10_000,
      processingStartedMs: Date.now() - 4_000,
      elapsedMs: 4_000,
    } as any);

    const wrapper = mount(
      defineComponent({
        setup() {
          const time = useJobTimeDisplay(job);
          return { time };
        },
        template: "<div />",
      }),
    );

    const vm: any = wrapper.vm;
    expect(vm.time.shouldShowTimeInfo.value).toBe(true);
    expect(vm.time.isProcessing.value).toBe(true);
    expect(vm.time.elapsedTimeDisplay.value).toBe("0:04");
    expect(vm.time.estimatedTotalTimeDisplay.value).toBe("0:08");

    wrapper.unmount();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });

  it("shares a single 1s ticker across visible rows when real-time elapsed needs wall clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const jobA = ref<TranscodeJob>({
      id: "job-a",
      filename: "a.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "processing",
      progress: 1,
      startTime: Date.now() - 5_000,
      elapsedMs: undefined,
    } as any);

    const jobB = ref<TranscodeJob>({
      id: "job-b",
      filename: "b.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "processing",
      progress: 1,
      startTime: Date.now() - 7_000,
      elapsedMs: undefined,
    } as any);

    const wrapperA = mount(
      defineComponent({
        setup() {
          const time = useJobTimeDisplay(jobA);
          return { time };
        },
        template: "<div />",
      }),
    );

    const wrapperB = mount(
      defineComponent({
        setup() {
          const time = useJobTimeDisplay(jobB);
          return { time };
        },
        template: "<div />",
      }),
    );

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(0);

    wrapperA.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(0);

    wrapperB.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });

  it("does not re-render time labels on high-frequency backend elapsedMs/progress ticks (samples at 1Hz)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const job = ref<TranscodeJob>({
      id: "job-throttle",
      filename: "throttle.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "processing",
      progress: 10,
      startTime: Date.now() - 10_000,
      processingStartedMs: Date.now() - 10_000,
      elapsedMs: 10_000,
      waitMetadata: { processedWallMillis: 0 },
    } as any);

    const wrapper = mount(
      defineComponent({
        setup() {
          const time = useJobTimeDisplay(job);
          return { time };
        },
        template: "<div />",
      }),
    );

    const vm: any = wrapper.vm;
    expect(vm.time.elapsedTimeDisplay.value).toBe("0:10");
    expect(vm.time.estimatedTotalTimeDisplay.value).toBe("1:40");

    // Simulate rapid backend ticks: these should not drive the UI time labels
    // directly (we update on the shared 1Hz ticker).
    job.value.elapsedMs = 123_456;
    job.value.progress = 20;
    await Promise.resolve();

    expect(vm.time.elapsedTimeDisplay.value).toBe("0:10");
    expect(vm.time.estimatedTotalTimeDisplay.value).toBe("1:40");

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(vm.time.elapsedTimeDisplay.value).toBe("0:11");
    expect(vm.time.estimatedTotalTimeDisplay.value).toBe("0:55");

    wrapper.unmount();
    vi.useRealTimers();
  });
});
