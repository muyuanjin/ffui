import { computed, onUnmounted, ref, watch, type ComputedRef } from "vue";
import type { QueueProgressStyle, TranscodeJob } from "@/types";

const DEFAULT_PROGRESS_INTERVAL_MS = 250;

interface UseSmoothProgressOptions {
  job: ComputedRef<TranscodeJob>;
  progressStyle: ComputedRef<QueueProgressStyle | undefined>;
  progressUpdateIntervalMs?: ComputedRef<number | undefined>;
}

export function useSmoothProgress(options: UseSmoothProgressOptions) {
  const isSkipped = computed(() => options.job.value.status === "skipped");

  const effectiveProgressStyle = computed<QueueProgressStyle>(
    () => options.progressStyle.value ?? "bar",
  );

  const clampedProgress = computed(() => {
    const status = options.job.value.status;
    const progress = options.job.value.progress;

    if (
      status === "completed" ||
      status === "failed" ||
      status === "skipped" ||
      status === "cancelled"
    ) {
      return 100;
    }

    if (status === "processing" || status === "paused") {
      const raw = typeof progress === "number" ? progress : 0;
      return Math.max(0, Math.min(100, raw));
    }

    return 0; // waiting / queued
  });

  const displayedProgress = ref(clampedProgress.value);
  const displayedClampedProgress = computed(() =>
    Math.max(0, Math.min(100, displayedProgress.value)),
  );

  const effectiveProgressIntervalMs = computed(() => {
    const raw = options.progressUpdateIntervalMs?.value;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return Math.min(Math.max(raw, 50), 2000);
    }
    return DEFAULT_PROGRESS_INTERVAL_MS;
  });

  const smoothDurationMs = computed(() => {
    const interval = effectiveProgressIntervalMs.value;
    if (interval <= 80) return 0;
    if (interval <= 200) return 160;
    return Math.min(interval, 600);
  });

  let progressAnimationFrame: number | null = null;
  let progressAnimStartTime = 0;
  let progressAnimStartValue = 0;
  let progressAnimTargetValue = 0;

  const cancelProgressAnimation = () => {
    if (progressAnimationFrame != null) {
      window.cancelAnimationFrame(progressAnimationFrame);
      progressAnimationFrame = null;
    }
  };

  const progressAnimationTick = () => {
    progressAnimationFrame = null;
    const now = performance.now();
    const durationMs = smoothDurationMs.value;
    if (durationMs <= 0) {
      displayedProgress.value = Math.min(100, Math.max(0, progressAnimTargetValue));
      return;
    }
    const elapsed = now - progressAnimStartTime;
    const t = Math.min(1, durationMs > 0 ? elapsed / durationMs : 1);
    const eased = t;
    const next =
      progressAnimStartValue +
      (progressAnimTargetValue - progressAnimStartValue) * eased;

    displayedProgress.value = Math.min(100, Math.max(0, next));

    if (t < 1) {
      progressAnimationFrame = window.requestAnimationFrame(progressAnimationTick);
    } else {
      displayedProgress.value = progressAnimTargetValue;
    }
  };

  watch(
    () => clampedProgress.value,
    (next) => {
      const target = next;
      if (
        options.job.value.status === "completed" ||
        options.job.value.status === "failed" ||
        options.job.value.status === "cancelled" ||
        options.job.value.status === "skipped"
      ) {
        displayedProgress.value = target;
        return;
      }
      if (options.job.value.status !== "processing") return;
      if (Math.abs(target - displayedProgress.value) < 0.1) {
        displayedProgress.value = target;
        return;
      }
      if (smoothDurationMs.value <= 0) {
        displayedProgress.value = target;
        return;
      }

      cancelProgressAnimation();
      progressAnimStartTime = performance.now();
      progressAnimStartValue = displayedProgress.value;
      progressAnimTargetValue = target;
      progressAnimationFrame = window.requestAnimationFrame(progressAnimationTick);
    },
    { immediate: true },
  );

  watch(
    () => options.job.value.status,
    (status, prevStatus) => {
      const reachedTerminalFromProcessing =
        prevStatus === "processing" &&
        (status === "completed" || status === "failed" || status === "cancelled" || status === "skipped");

      if (reachedTerminalFromProcessing) {
        const target = clampedProgress.value;
        const start = displayedProgress.value;

        if (Math.abs(target - start) < 0.1) {
          displayedProgress.value = target;
        } else if (smoothDurationMs.value > 0) {
          progressAnimStartTime = performance.now();
          progressAnimStartValue = start;
          progressAnimTargetValue = target;
          progressAnimationFrame = window.requestAnimationFrame(progressAnimationTick);
        } else {
          displayedProgress.value = target;
        }
        return;
      }

      if (
        status === "completed" ||
        status === "failed" ||
        status === "cancelled" ||
        status === "skipped"
      ) {
        cancelProgressAnimation();
        displayedProgress.value = clampedProgress.value;
        return;
      }

      if (status === "processing") {
        displayedProgress.value = clampedProgress.value;
        return;
      }

      cancelProgressAnimation();
      displayedProgress.value = clampedProgress.value;
    },
  );

  const showBarProgress = computed(
    () =>
      !isSkipped.value &&
      options.job.value.status !== "waiting" &&
      effectiveProgressStyle.value === "bar",
  );

  const showCardFillProgress = computed(
    () =>
      !isSkipped.value &&
      options.job.value.status !== "waiting" &&
      effectiveProgressStyle.value === "card-fill",
  );

  const showRippleCardProgress = computed(
    () =>
      !isSkipped.value &&
      options.job.value.status !== "waiting" &&
      effectiveProgressStyle.value === "ripple-card",
  );

  onUnmounted(() => {
    cancelProgressAnimation();
  });

  return {
    isSkipped,
    displayedClampedProgress,
    showBarProgress,
    showCardFillProgress,
    showRippleCardProgress,
    cancelProgressAnimation,
  };
}
