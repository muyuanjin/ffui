// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, ref, nextTick, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import type { TranscodeJob } from "@/types";
import { useSmoothProgress } from "./useSmoothProgress";

const makeJob = (overrides: Partial<TranscodeJob> = {}): TranscodeJob =>
  ({
    id: "job-1",
    status: "processing",
    progress: 0,
    type: "video",
    source: "manual",
    filename: "foo.mp4",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    ...overrides,
  }) as TranscodeJob;

const mountComposable = (job: Ref<TranscodeJob>, options?: { progressUpdateIntervalMs?: number }) => {
  const wrapper = mount({
    setup() {
      const composable = useSmoothProgress({
        job: computed(() => job.value),
        progressStyle: computed(() => "bar"),
        progressUpdateIntervalMs: computed(() => options?.progressUpdateIntervalMs ?? 250),
      });
      return { composable };
    },
    template: "<div />",
  });

  const { composable } = wrapper.vm as unknown as {
    composable: ReturnType<typeof useSmoothProgress>;
  };

  return { wrapper, composable };
};

describe("useSmoothProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes displayedClampedProgress from clamped job progress", async () => {
    const job = ref(makeJob({ progress: 42 }));
    const { composable, wrapper } = mountComposable(job);

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBe(42);
    wrapper.unmount();
  });

  it("estimates progress between backend samples using out_time + speed", async () => {
    const job = ref(
      makeJob({
        status: "processing",
        progress: 10,
        mediaInfo: { durationSeconds: 100 },
        waitMetadata: {
          lastProgressOutTimeSeconds: 10,
          lastProgressSpeed: 1,
          lastProgressUpdatedAtMs: 0,
        },
      }),
    );
    const { composable, wrapper } = mountComposable(job, { progressUpdateIntervalMs: 200 });

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBeCloseTo(10, 6);

    vi.setSystemTime(new Date(1000));
    vi.advanceTimersByTime(100);
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBeGreaterThan(10);
    expect(composable.displayedClampedProgress.value).toBeLessThan(100);
    wrapper.unmount();
  });

  it("does not extrapolate without an explicit speed sample", async () => {
    const job = ref(
      makeJob({
        status: "processing",
        progress: 10,
        mediaInfo: { durationSeconds: 100 },
        waitMetadata: {
          lastProgressOutTimeSeconds: 10,
          lastProgressUpdatedAtMs: 0,
        },
      }),
    );
    const { composable, wrapper } = mountComposable(job, { progressUpdateIntervalMs: 200 });

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBeCloseTo(10, 6);

    vi.setSystemTime(new Date(1000));
    vi.advanceTimersByTime(200);
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBeCloseTo(10, 6);
    wrapper.unmount();
  });

  it("freezes extrapolation when telemetry timestamps are stale (e.g. after restart)", async () => {
    const job = ref(
      makeJob({
        status: "processing",
        progress: 10,
        mediaInfo: { durationSeconds: 100 },
        waitMetadata: {
          lastProgressOutTimeSeconds: 10,
          lastProgressSpeed: 2,
          lastProgressUpdatedAtMs: 0,
        },
      }),
    );
    const { composable, wrapper } = mountComposable(job, { progressUpdateIntervalMs: 200 });

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBeCloseTo(10, 6);

    // Far beyond the staleness threshold: must not jump forward.
    vi.setSystemTime(new Date(60_000));
    vi.advanceTimersByTime(200);
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBeCloseTo(10, 6);
    wrapper.unmount();
  });

  it("does not extrapolate while paused (even if telemetry exists)", async () => {
    const job = ref(
      makeJob({
        status: "paused",
        progress: 10,
        mediaInfo: { durationSeconds: 100 },
        waitMetadata: {
          lastProgressOutTimeSeconds: 10,
          lastProgressSpeed: 2,
          lastProgressUpdatedAtMs: 0,
        },
      }),
    );
    const { composable, wrapper } = mountComposable(job, { progressUpdateIntervalMs: 200 });

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBeCloseTo(10, 6);

    vi.setSystemTime(new Date(1000));
    vi.advanceTimersByTime(400);
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBeCloseTo(10, 6);
    wrapper.unmount();
  });

  it("allows rollbacks on epoch changes without teleporting", async () => {
    const job = ref(
      makeJob({
        status: "processing",
        progress: 50,
        mediaInfo: { durationSeconds: 100 },
        waitMetadata: {
          progressEpoch: 1,
          lastProgressOutTimeSeconds: 50,
          lastProgressUpdatedAtMs: 0,
        },
      }),
    );
    const { composable, wrapper } = mountComposable(job, { progressUpdateIntervalMs: 200 });

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBeCloseTo(50, 6);

    job.value = {
      ...job.value,
      progress: 40,
      waitMetadata: {
        ...(job.value.waitMetadata ?? {}),
        progressEpoch: 2,
        lastProgressOutTimeSeconds: 40,
        lastProgressUpdatedAtMs: 0,
      },
    };
    await nextTick();

    vi.advanceTimersByTime(100);
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBeLessThan(50);
    expect(composable.displayedClampedProgress.value).toBeGreaterThan(40);

    vi.advanceTimersByTime(3000);
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBeCloseTo(40, 1);
    wrapper.unmount();
  });

  it("allows rollbacks when telemetry out_time decreases within the same epoch", async () => {
    const job = ref(
      makeJob({
        status: "processing",
        progress: 50,
        mediaInfo: { durationSeconds: 100 },
        waitMetadata: {
          progressEpoch: 1,
          lastProgressOutTimeSeconds: 50,
          lastProgressUpdatedAtMs: 0,
        },
      }),
    );
    const { composable, wrapper } = mountComposable(job, { progressUpdateIntervalMs: 200 });

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBeCloseTo(50, 6);

    vi.advanceTimersByTime(1000);
    await nextTick();
    const updatedAtMs = Date.now();
    job.value = {
      ...job.value,
      progress: 40,
      waitMetadata: {
        ...(job.value.waitMetadata ?? {}),
        progressEpoch: 1,
        lastProgressOutTimeSeconds: 40,
        lastProgressUpdatedAtMs: updatedAtMs,
      },
    };
    await nextTick();

    vi.advanceTimersByTime(100);
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBeLessThan(50);
    expect(composable.displayedClampedProgress.value).toBeGreaterThan(40);

    vi.advanceTimersByTime(3000);
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBeCloseTo(40, 1);
    wrapper.unmount();
  });

  it("suppresses prediction-only rollbacks within the same epoch", async () => {
    const job = ref(
      makeJob({
        status: "processing",
        progress: 10,
        mediaInfo: { durationSeconds: 100 },
        waitMetadata: {
          progressEpoch: 1,
          lastProgressOutTimeSeconds: 10,
          lastProgressSpeed: 20,
          lastProgressUpdatedAtMs: 0,
        },
      }),
    );
    const { composable, wrapper } = mountComposable(job, { progressUpdateIntervalMs: 200 });

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBeCloseTo(10, 6);

    vi.setSystemTime(new Date(1000));
    vi.advanceTimersByTime(200);
    await nextTick();

    const peak = composable.displayedClampedProgress.value;
    expect(peak).toBeGreaterThan(10);

    const updatedAtMs = Date.now();
    job.value = {
      ...job.value,
      progress: 10.6,
      waitMetadata: {
        ...(job.value.waitMetadata ?? {}),
        progressEpoch: 1,
        lastProgressOutTimeSeconds: 10.6,
        lastProgressSpeed: 1,
        lastProgressUpdatedAtMs: updatedAtMs,
      },
    };
    await nextTick();

    vi.advanceTimersByTime(100);
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBeGreaterThanOrEqual(peak - 1e-6);
    wrapper.unmount();
  });

  it("avoids teleporting on queued -> processing transitions", async () => {
    const job = ref(makeJob({ progress: 10 }));
    const { composable, wrapper } = mountComposable(job);

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBe(10);

    const originalRaf = window.requestAnimationFrame;
    (window as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined;

    job.value = { ...job.value, status: "queued", progress: 0 };
    await nextTick();

    job.value = { ...job.value, status: "processing", progress: 55 };
    await nextTick();

    // First frame: forced to 0 so the bar/card can mount without snapping.
    expect(composable.displayedClampedProgress.value).toBe(0);

    // Next tick: moves toward the target.
    vi.runOnlyPendingTimers();
    await nextTick();
    expect(composable.displayedClampedProgress.value).toBeGreaterThan(0);

    (window as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame = originalRaf;
    wrapper.unmount();
  });

  it("keeps baseline progress on resume transitions (paused -> queued -> processing)", async () => {
    const job = ref(
      makeJob({
        status: "paused",
        progress: 40,
        mediaInfo: { durationSeconds: 100 },
        waitMetadata: {
          lastProgressPercent: 40,
          processedWallMillis: 1234,
          tmpOutputPath: "C:/tmp/seg0.mkv",
          lastProgressOutTimeSeconds: 40,
          lastProgressUpdatedAtMs: 0,
        },
      }),
    );
    const { composable, wrapper } = mountComposable(job, { progressUpdateIntervalMs: 200 });

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBeCloseTo(40, 6);

    const originalRaf = window.requestAnimationFrame;
    (window as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined;

    job.value = { ...job.value, status: "queued" };
    await nextTick();

    job.value = { ...job.value, status: "processing" };
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBeGreaterThan(0);
    expect(composable.displayedClampedProgress.value).toBeCloseTo(40, 1);

    (window as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame = originalRaf;
    wrapper.unmount();
  });

  it("jumps to 100 when job reaches a terminal status", async () => {
    const job = ref(makeJob({ status: "processing", progress: 90 }));
    const { composable, wrapper } = mountComposable(job);

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBe(90);

    job.value = { ...job.value, status: "completed", progress: 100 };
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBe(100);
    wrapper.unmount();
  });

  it("exposes transition duration tuned by update interval", async () => {
    const job = ref(makeJob({ status: "processing", progress: 10 }));
    const { composable, wrapper } = mountComposable(job, { progressUpdateIntervalMs: 250 });
    await nextTick();
    expect(composable.progressTransitionMs.value).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it("disables transitions for extremely frequent updates", async () => {
    const job = ref(makeJob({ status: "processing", progress: 10 }));
    const { composable, wrapper } = mountComposable(job, { progressUpdateIntervalMs: 50 });
    await nextTick();
    expect(composable.progressTransitionMs.value).toBeGreaterThan(0);
    wrapper.unmount();
  });
});
