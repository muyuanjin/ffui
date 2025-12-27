import { computed, type ComputedRef } from "vue";
import type { QueueProgressStyle, TranscodeJob } from "@/types";
import { clampProgressUpdateIntervalMs, deriveProgressTransitionMs } from "@/lib/progressTransition";

interface UseSmoothProgressOptions {
  job: ComputedRef<TranscodeJob>;
  progressStyle: ComputedRef<QueueProgressStyle | undefined>;
  progressUpdateIntervalMs?: ComputedRef<number | undefined>;
}

export function useSmoothProgress(options: UseSmoothProgressOptions) {
  const isSkipped = computed(() => options.job.value.status === "skipped");

  const effectiveProgressStyle = computed<QueueProgressStyle>(() => options.progressStyle.value ?? "bar");

  const clampedProgress = computed<number>(() => {
    const status = options.job.value.status;
    const progress = options.job.value.progress;

    if (status === "completed" || status === "failed" || status === "skipped" || status === "cancelled") {
      return 100;
    }

    if (status === "processing" || status === "paused") {
      const raw = typeof progress === "number" ? progress : 0;
      return Math.max(0, Math.min(100, raw));
    }

    return 0; // queued
  });

  const effectiveProgressIntervalMs = computed(() => {
    return clampProgressUpdateIntervalMs(options.progressUpdateIntervalMs?.value);
  });

  const progressTransitionMs = computed<number>(() => {
    const status = options.job.value.status;
    if (status === "queued") return 0;
    if (status === "completed" || status === "failed" || status === "cancelled" || status === "skipped") return 0;

    return deriveProgressTransitionMs(effectiveProgressIntervalMs.value);
  });

  const showBarProgress = computed(
    () => !isSkipped.value && options.job.value.status !== "queued" && effectiveProgressStyle.value === "bar",
  );

  const showCardFillProgress = computed(
    () => !isSkipped.value && options.job.value.status !== "queued" && effectiveProgressStyle.value === "card-fill",
  );

  const showRippleCardProgress = computed(
    () => !isSkipped.value && options.job.value.status !== "queued" && effectiveProgressStyle.value === "ripple-card",
  );

  return {
    isSkipped,
    displayedClampedProgress: clampedProgress,
    progressTransitionMs,
    showBarProgress,
    showCardFillProgress,
    showRippleCardProgress,
  };
}
