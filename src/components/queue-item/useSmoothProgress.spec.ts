import { describe, it, expect, vi, beforeEach } from "vitest";
import { computed, ref, nextTick } from "vue";
import type { TranscodeJob } from "@/types";
import { useSmoothProgress } from "./useSmoothProgress";

vi.mock("gsap", () => {
  return {
    default: {
      to(state: any, opts: any) {
        // 直接跳到目标值，便于在测试里做断言
        if (typeof opts?.value === "number") {
          state.value = opts.value;
          opts.onUpdate?.();
          opts.onComplete?.();
        }
        return {
          kill() {
            // no-op
          },
        };
      },
    },
  };
});

const makeJob = (overrides: Partial<TranscodeJob> = {}): TranscodeJob => ({
  id: "job-1",
  status: "processing",
  progress: 0,
  type: "video",
  source: "manual",
  filename: "foo.mp4",
  createdAtMs: Date.now(),
  updatedAtMs: Date.now(),
  ...overrides,
} as TranscodeJob);

describe("useSmoothProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("initializes displayedClampedProgress from clamped job progress", async () => {
    const job = ref(makeJob({ progress: 42 }));
    const composable = useSmoothProgress({
      job: computed(() => job.value),
      progressStyle: computed(() => "bar"),
      progressUpdateIntervalMs: computed(() => 250),
    });

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBe(42);
  });

  it("smoothly updates progress when job.progress increases while processing", async () => {
    const job = ref(makeJob({ progress: 10 }));
    const composable = useSmoothProgress({
      job: computed(() => job.value),
      progressStyle: computed(() => "bar"),
      progressUpdateIntervalMs: computed(() => 250),
    });

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBe(10);

    job.value = { ...job.value, progress: 55 };
    await nextTick();

    // 由于在测试环境中 gsap 被 mock 成立即跳到目标值，因此应直接等于 55
    expect(composable.displayedClampedProgress.value).toBe(55);
  });

  it("jumps to 100 when job reaches a terminal status", async () => {
    const job = ref(makeJob({ status: "processing", progress: 90 }));
    const composable = useSmoothProgress({
      job: computed(() => job.value),
      progressStyle: computed(() => "bar"),
      progressUpdateIntervalMs: computed(() => 250),
    });

    await nextTick();
    expect(composable.displayedClampedProgress.value).toBe(90);

    job.value = { ...job.value, status: "completed", progress: 100 };
    await nextTick();

    expect(composable.displayedClampedProgress.value).toBe(100);
  });
});

