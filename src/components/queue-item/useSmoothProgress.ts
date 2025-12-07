import { computed, onUnmounted, ref, watch, type ComputedRef } from "vue";
import gsap from "gsap";
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

  // 优化平滑动画持续时间的计算
  // 降低最大持续时间，提高响应速度
  const smoothDurationMs = computed(() => {
    const interval = effectiveProgressIntervalMs.value;
    // 对于极短的更新间隔，禁用动画避免卡顿
    if (interval <= 50) return 0;
    // 缩短动画时长，最长不超过300ms
    if (interval <= 100) return 80;
    if (interval <= 200) return 120;
    return Math.min(interval * 0.6, 300);
  });

  let progressTween: gsap.core.Tween | null = null;

  const cancelProgressAnimation = () => {
    if (progressTween) {
      progressTween.kill();
      progressTween = null;
    }
  };

  const animateTo = (target: number) => {
    cancelProgressAnimation();

    const durationMs = smoothDurationMs.value;
    if (durationMs <= 0) {
      displayedProgress.value = Math.min(100, Math.max(0, target));
      return;
    }

    // 优化：缩短动画时长上限，使用更线性的缓动
    const durationSec = Math.min(Math.max(durationMs / 1000, 0.05), 0.3);
    const state = { value: displayedProgress.value };

    progressTween = gsap.to(state, {
      value: target,
      duration: durationSec,
      ease: "power1.inOut", // 使用更温和的缓动函数
      onUpdate: () => {
        displayedProgress.value = Math.min(100, Math.max(0, state.value));
      },
      onComplete: () => {
        displayedProgress.value = Math.min(100, Math.max(0, target));
        progressTween = null;
      },
    });
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
      // 优化：降低跳过动画的阈值，让更多变化都有动画
      if (Math.abs(target - displayedProgress.value) < 0.01) {
        displayedProgress.value = target;
        return;
      }
      if (smoothDurationMs.value <= 0) {
        displayedProgress.value = target;
        return;
      }
      animateTo(target);
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
        // 优化：降低跳过动画的阈值
        if (Math.abs(target - displayedProgress.value) < 0.01 || smoothDurationMs.value <= 0) {
          displayedProgress.value = target;
        } else {
          animateTo(target);
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
