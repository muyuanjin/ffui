import { computed, ref, watch, type Ref, type ComputedRef } from "vue";
import gsap from "gsap";
import type { TranscodeJob, AppSettings, TaskbarProgressMode } from "@/types";

// ----- Constants -----

const DEFAULT_PROGRESS_UPDATE_INTERVAL_MS = 250;

// ----- Helper Functions -----

/**
 * Calculate normalized progress (0-1) for a job for aggregate calculations.
 * Terminal states (completed, failed, skipped, cancelled) count as 1.
 * Processing/paused jobs use their actual progress.
 * Waiting/queued jobs count as 0.
 */
export const normalizedJobProgressForAggregate = (job: TranscodeJob): number => {
  if (
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "skipped" ||
    job.status === "cancelled"
  ) {
    return 1;
  }
  if (job.status === "processing" || job.status === "paused") {
    const raw = typeof job.progress === "number" ? job.progress : 0;
    const clamped = Math.min(Math.max(raw, 0), 100);
    return clamped / 100;
  }
  // waiting / queued
  return 0;
};

/**
 * Calculate the weight for a job in taskbar progress aggregation.
 * Weight is determined by the taskbar progress mode setting.
 */
export const taskbarJobWeightForAggregate = (
  job: TranscodeJob,
  mode: TaskbarProgressMode,
): number => {
  const media = job.mediaInfo;
  const sizeMb = Math.max(
    typeof media?.sizeMB === "number" ? media.sizeMB : job.originalSizeMB ?? 0,
    0,
  );
  const durationSeconds = Math.max(media?.durationSeconds ?? 0, 0);
  const estimatedSeconds = Math.max(job.estimatedSeconds ?? 0, 0);

  let weight: number;

  if (mode === "bySize") {
    weight = sizeMb > 0 ? sizeMb : 1;
  } else if (mode === "byDuration") {
    if (durationSeconds > 0) {
      weight = durationSeconds;
    } else if (sizeMb > 0) {
      // Match backend behavior: when duration is unknown, roughly map size to "seconds" as relative weight.
      weight = sizeMb * 8;
    } else {
      weight = 1;
    }
  } else {
    // byEstimatedTime
    if (estimatedSeconds > 0) {
      weight = estimatedSeconds;
    } else if (durationSeconds > 0) {
      weight = durationSeconds;
    } else if (sizeMb > 0) {
      weight = sizeMb * 8;
    } else {
      weight = 1;
    }
  }

  // Ensure each job has at least a tiny weight to avoid division by zero.
  return Math.max(weight, 1e-3);
};

// ----- Composable -----

export interface UseJobProgressOptions {
  /** The list of jobs. */
  jobs: Ref<TranscodeJob[]>;
  /** App settings (for taskbar progress mode and progress update interval). */
  appSettings: Ref<AppSettings | null>;
}

export interface UseJobProgressReturn {
  /** Effective progress update interval in milliseconds. */
  progressUpdateIntervalMs: ComputedRef<number>;
  /** Global taskbar progress percentage (0-100 or null if no jobs). */
  globalTaskbarProgressPercent: ComputedRef<number | null>;
  /** Whether there are any active (non-terminal) jobs. */
  hasActiveJobs: ComputedRef<boolean>;
  /** Header progress bar percentage. */
  headerProgressPercent: Ref<number>;
  /** Whether header progress bar is visible. */
  headerProgressVisible: Ref<boolean>;
  /** Whether header progress bar is fading out. */
  headerProgressFading: Ref<boolean>;
  /** Clean up timers (call in onUnmounted). */
  cleanup: () => void;
}

/**
 * Composable for job progress calculations and header progress bar state.
 */
export function useJobProgress(options: UseJobProgressOptions): UseJobProgressReturn {
  const { jobs, appSettings } = options;

  // ----- State -----
  const headerProgressPercent = ref(0);
  const headerProgressVisible = ref(false);
  const headerProgressFading = ref(false);
  let headerProgressFadeTimer: number | undefined;

  // ----- Computed -----

  /**
   * Derive an effective progress update interval (ms) from AppSettings so both
   * the backend ffmpeg stats period and the frontend easing use the same
   * notion of "refresh cadence". When unset, fall back to the engine default.
   */
  const progressUpdateIntervalMs = computed<number>(() => {
    const raw = appSettings.value?.progressUpdateIntervalMs;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return Math.min(Math.max(raw, 50), 2000);
    }
    return DEFAULT_PROGRESS_UPDATE_INTERVAL_MS;
  });

  /**
   * Calculate global taskbar progress as a weighted average.
   */
  const globalTaskbarProgressPercent = computed<number | null>(() => {
    const list = jobs.value;
    if (!list || list.length === 0) return null;

    const mode: TaskbarProgressMode =
      appSettings.value?.taskbarProgressMode ?? "byEstimatedTime";

    let totalWeight = 0;
    let weighted = 0;

    for (const job of list) {
      const w = taskbarJobWeightForAggregate(job, mode);
      const p = normalizedJobProgressForAggregate(job);
      totalWeight += w;
      weighted += w * p;
    }

    if (totalWeight <= 0) return null;
    const value = (weighted / totalWeight) * 100;
    const clamped = Math.max(0, Math.min(100, value));
    // Preserve decimals for smoother visual display; format as needed when rendering.
    return clamped;
  });

  /**
   * Check if there are any active (non-terminal) jobs.
   */
  const hasActiveJobs = computed(() => {
    const list = jobs.value;
    if (!list || list.length === 0) return false;
    return list.some(
      (job) =>
        job.status === "processing" ||
        job.status === "paused" ||
        job.status === "waiting" ||
        job.status === "queued",
    );
  });

  // 使用 GSAP 对标题栏进度做补间动画，避免大步跳变。
  let headerProgressTween: gsap.core.Tween | null = null;

  const animateHeaderProgressTo = (target: number) => {
    if (!Number.isFinite(target)) return;

    if (headerProgressTween) {
      headerProgressTween.kill();
      headerProgressTween = null;
    }

    const durationMs = progressUpdateIntervalMs.value;
    if (durationMs <= 0) {
      headerProgressPercent.value = target;
      return;
    }

    // 优化：缩短动画时长，使用更线性的缓动
    const durationSec = Math.min(Math.max(durationMs * 0.5 / 1000, 0.05), 0.3);
    const state = { value: headerProgressPercent.value };

    headerProgressTween = gsap.to(state, {
      value: target,
      duration: durationSec,
      ease: "power1.inOut", // 使用更温和的缓动函数
      onUpdate: () => {
        headerProgressPercent.value = Math.max(0, Math.min(100, state.value));
      },
      onComplete: () => {
        headerProgressPercent.value = Math.max(0, Math.min(100, target));
        headerProgressTween = null;
      },
    });
  };

  // ----- Header Progress Animation Watch -----
  watch(
    [globalTaskbarProgressPercent, hasActiveJobs],
    ([percent, active]) => {
      if (percent != null && active) {
        animateHeaderProgressTo(percent);
        headerProgressVisible.value = true;
        headerProgressFading.value = false;
        if (headerProgressFadeTimer !== undefined) {
          window.clearTimeout(headerProgressFadeTimer);
          headerProgressFadeTimer = undefined;
        }
        return;
      }

      // No active work or queue is empty: fade out the header progress effect.
      if (!headerProgressVisible.value) {
        headerProgressPercent.value = percent ?? 0;
        headerProgressFading.value = false;
        return;
      }

      headerProgressFading.value = true;
      if (headerProgressFadeTimer !== undefined) {
        window.clearTimeout(headerProgressFadeTimer);
      }
      headerProgressFadeTimer = window.setTimeout(() => {
        if (headerProgressTween) {
          headerProgressTween.kill();
          headerProgressTween = null;
        }
        headerProgressVisible.value = false;
        headerProgressFading.value = false;
        headerProgressPercent.value = 0;
        headerProgressFadeTimer = undefined;
      }, 400); // 缩短淡出时间到400ms
    },
  );

  // ----- Cleanup -----
  const cleanup = () => {
    if (headerProgressFadeTimer !== undefined) {
      window.clearTimeout(headerProgressFadeTimer);
      headerProgressFadeTimer = undefined;
    }
    if (headerProgressTween) {
      headerProgressTween.kill();
      headerProgressTween = null;
    }
  };

  return {
    progressUpdateIntervalMs,
    globalTaskbarProgressPercent,
    hasActiveJobs,
    headerProgressPercent,
    headerProgressVisible,
    headerProgressFading,
    cleanup,
  };
}

export default useJobProgress;
