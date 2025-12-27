// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
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
  it("initializes displayedClampedProgress from clamped job progress", async () => {
    const job = ref(makeJob({ progress: 42 }));
    const { composable, wrapper } = mountComposable(job);

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBe(42);
    wrapper.unmount();
  });

  it("tracks job.progress updates while processing", async () => {
    const job = ref(makeJob({ progress: 10 }));
    const { composable, wrapper } = mountComposable(job);

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBe(10);

    job.value = { ...job.value, progress: 55 };
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBe(55);
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
    expect(composable.progressTransitionMs.value).toBe(150);
    wrapper.unmount();
  });

  it("disables transitions for extremely frequent updates", async () => {
    const job = ref(makeJob({ status: "processing", progress: 10 }));
    const { composable, wrapper } = mountComposable(job, { progressUpdateIntervalMs: 50 });
    await nextTick();
    expect(composable.progressTransitionMs.value).toBe(0);
    wrapper.unmount();
  });
});
