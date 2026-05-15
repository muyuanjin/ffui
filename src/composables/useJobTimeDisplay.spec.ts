// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { ref, defineComponent, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { useJobTimeDisplay } from "./useJobTimeDisplay";
import type { TranscodeJob } from "@/types";

describe("useJobTimeDisplay", () => {
  const mountTimeDisplay = (job: Ref<TranscodeJob>) => {
    const wrapper = mount(
      defineComponent({
        setup() {
          const time = useJobTimeDisplay(job);
          return { time };
        },
        template: "<div />",
      }),
    );
    return { wrapper, time: (wrapper.vm as any).time as ReturnType<typeof useJobTimeDisplay> };
  };

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

  it("shows regular processing ETA when no phase telemetry is active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const job = ref<TranscodeJob>({
      id: "job-regular-eta",
      filename: "regular.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "processing",
      progress: 25,
      startTime: Date.now() - 10_000,
      processingStartedMs: Date.now() - 10_000,
      elapsedMs: 10_000,
    } as any);

    const { wrapper, time } = mountTimeDisplay(job);
    expect(time.estimatedRemainingTimeDisplay.value).toBe("0:30");
    expect(time.isRemainingTimeCalculating.value).toBe(false);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("uses current phase ETA from out_time and speed during final mux", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const job = ref<TranscodeJob>({
      id: "job-phase-eta",
      filename: "phase.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "processing",
      progress: 100,
      startTime: Date.now() - 60_000,
      processingStartedMs: Date.now() - 60_000,
      progressPhase: "muxing",
      phaseDurationSeconds: 100,
      phaseOutTimeSeconds: 40,
      phaseSpeed: 2,
      phaseUpdatedAtMs: Date.now(),
    } as any);

    const { wrapper, time } = mountTimeDisplay(job);
    expect(time.phaseDisplayKey.value).toBe("queue.progressPhase.muxing");
    expect(time.estimatedRemainingTimeDisplay.value).toBe("0:30");
    expect(time.isRemainingTimeCalculating.value).toBe(false);

    vi.advanceTimersByTime(5_000);
    expect(time.estimatedRemainingTimeDisplay.value).toBe("0:25");

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("does not invent remaining time when phase telemetry is incomplete", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const job = ref<TranscodeJob>({
      id: "job-phase-incomplete",
      filename: "phase-incomplete.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "processing",
      progress: 100,
      startTime: Date.now() - 60_000,
      processingStartedMs: Date.now() - 60_000,
      progressPhase: "audioFinalizing",
      phaseUpdatedAtMs: Date.now(),
    } as any);

    const { wrapper, time } = mountTimeDisplay(job);
    expect(time.estimatedRemainingTimeDisplay.value).toBe("-");
    expect(time.isRemainingTimeCalculating.value).toBe(true);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("keeps the last phase ETA visible and counts it down between sparse phase samples", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:10Z"));

    const job = ref<TranscodeJob>({
      id: "job-phase-stale",
      filename: "phase-stale.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "processing",
      progress: 100,
      startTime: Date.now() - 60_000,
      processingStartedMs: Date.now() - 60_000,
      progressPhase: "muxing",
      phaseDurationSeconds: 100,
      phaseOutTimeSeconds: 40,
      phaseSpeed: 2,
      phaseUpdatedAtMs: Date.now() - 6_000,
      phaseEtaMs: 30_000,
    } as any);

    const { wrapper, time } = mountTimeDisplay(job);
    expect(time.estimatedRemainingTimeDisplay.value).toBe("0:24");
    expect(time.isRemainingTimeCalculating.value).toBe(false);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("shows terminal elapsed time without requiring an ETA", () => {
    const job = ref<TranscodeJob>({
      id: "job-terminal",
      filename: "done.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      startTime: 1_000,
      endTime: 16_000,
    } as any);

    const { wrapper, time } = mountTimeDisplay(job);
    expect(time.isTerminalState.value).toBe(true);
    expect(time.elapsedTimeDisplay.value).toBe("0:15");
    expect(time.isRemainingTimeCalculating.value).toBe(false);

    wrapper.unmount();
  });
});
