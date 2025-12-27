import { computed, ref, watch, type Ref, type ComputedRef } from "vue";
import type { TranscodeJob, AppSettings, TaskbarProgressMode, TaskbarProgressScope } from "@/types";
import { clampProgressUpdateIntervalMs } from "@/lib/progressTransition";

// ----- Constants -----

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

type JobProgressPerfCounters = {
  rebuildCalls: number;
  rebuildJobsScanned: number;
  progressWatches: number;
  progressWatchUpdates: number;
};

const jobProgressPerfCounters: JobProgressPerfCounters = {
  rebuildCalls: 0,
  rebuildJobsScanned: 0,
  progressWatches: 0,
  progressWatchUpdates: 0,
};

export const __test = {
  resetPerfCounters: () => {
    jobProgressPerfCounters.rebuildCalls = 0;
    jobProgressPerfCounters.rebuildJobsScanned = 0;
    jobProgressPerfCounters.progressWatches = 0;
    jobProgressPerfCounters.progressWatchUpdates = 0;
  },
  getPerfCounters: (): JobProgressPerfCounters => ({ ...jobProgressPerfCounters }),
};

// ----- Helper Functions -----

/**
 * Calculate normalized progress (0-1) for a job for aggregate calculations.
 * Terminal states (completed, failed, skipped, cancelled) count as 1.
 * Processing/paused jobs use their actual progress.
 * Queued jobs count as 0.
 */
export const normalizedJobProgressForAggregate = (job: TranscodeJob): number => {
  if (isTerminalStatus(job.status)) {
    return 1;
  }
  if (job.status === "processing" || job.status === "paused") {
    const raw = typeof job.progress === "number" ? job.progress : 0;
    const clamped = Math.min(Math.max(raw, 0), 100);
    return clamped / 100;
  }
  // queued
  return 0;
};

/**
 * Calculate the weight for a job in taskbar progress aggregation.
 * Weight is determined by the taskbar progress mode setting.
 */
export const taskbarJobWeightForAggregate = (job: TranscodeJob, mode: TaskbarProgressMode): number => {
  const media = job.mediaInfo;
  const sizeMb = Math.max(typeof media?.sizeMB === "number" ? media.sizeMB : (job.originalSizeMB ?? 0), 0);
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

const isTerminalStatus = (status: TranscodeJob["status"]) =>
  status === "completed" || status === "failed" || status === "skipped" || status === "cancelled";

// ----- Composable -----

export interface UseJobProgressOptions {
  /** The list of jobs. */
  jobs: Ref<TranscodeJob[]>;
  /** Optional structural revision for the queue (changes only on non-progress updates). */
  queueStructureRevision?: Ref<number | null>;
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
  const { jobs, queueStructureRevision, appSettings } = options;

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
    return clampProgressUpdateIntervalMs(appSettings.value?.progressUpdateIntervalMs);
  });

  /**
   * Calculate global taskbar progress as a weighted average.
   *
   * Hot path requirement: progress ticks MUST NOT scan the full queue.
   */
  const aggregateTotalWeight = ref(0);
  const aggregateWeighted = ref(0);
  const aggregateById = new Map<string, { weight: number; normalized: number }>();
  let stopActiveJobWatches: Array<() => void> = [];

  const rebuildAggregate = () => {
    if (isTestEnv) {
      jobProgressPerfCounters.rebuildCalls += 1;
    }
    for (const stop of stopActiveJobWatches) stop();
    stopActiveJobWatches = [];
    aggregateById.clear();
    aggregateTotalWeight.value = 0;
    aggregateWeighted.value = 0;

    const list = jobs.value;
    if (!list || list.length === 0) return;
    if (isTestEnv) {
      jobProgressPerfCounters.rebuildJobsScanned += list.length;
    }

    const mode: TaskbarProgressMode = appSettings.value?.taskbarProgressMode ?? "byEstimatedTime";
    const scope: TaskbarProgressScope = appSettings.value?.taskbarProgressScope ?? "allJobs";

    const hasNonTerminal = list.some((job) => !isTerminalStatus(job.status));
    let eligibleJobs = list;
    if (scope === "activeAndQueued" && hasNonTerminal) {
      const cohortStart = Math.min(
        ...list
          .filter((job) => !isTerminalStatus(job.status))
          .map((job) => (typeof job.startTime === "number" ? job.startTime : Number.POSITIVE_INFINITY)),
      );

      if (Number.isFinite(cohortStart)) {
        eligibleJobs = list.filter((job) => {
          if (!isTerminalStatus(job.status)) return true;
          return typeof job.startTime === "number" && job.startTime >= cohortStart;
        });
      } else {
        eligibleJobs = list.filter((job) => !isTerminalStatus(job.status));
      }
    }
    if (eligibleJobs.length === 0) return;

    let totalWeight = 0;
    let weighted = 0;

    for (const job of eligibleJobs) {
      const w = taskbarJobWeightForAggregate(job, mode);
      const p = normalizedJobProgressForAggregate(job);
      totalWeight += w;
      weighted += w * p;
      aggregateById.set(job.id, { weight: w, normalized: p });

      if (job.status === "processing" || job.status === "paused") {
        if (isTestEnv) {
          jobProgressPerfCounters.progressWatches += 1;
        }
        const stop = watch(
          () => job.progress,
          (next) => {
            if (isTestEnv) {
              jobProgressPerfCounters.progressWatchUpdates += 1;
            }
            const entry = aggregateById.get(job.id);
            if (!entry) return;
            const prevP = entry.normalized;
            const raw = typeof next === "number" ? next : 0;
            const clamped = Math.min(Math.max(raw, 0), 100) / 100;
            const nextP = Math.max(prevP, clamped);
            if (nextP === prevP) return;
            entry.normalized = nextP;
            aggregateWeighted.value += entry.weight * (nextP - prevP);
          },
          { flush: "sync" },
        );
        stopActiveJobWatches.push(stop);
      }
    }

    aggregateTotalWeight.value = totalWeight;
    aggregateWeighted.value = weighted;
  };

  const globalTaskbarProgressPercent = computed<number | null>(() => {
    if (aggregateTotalWeight.value <= 0) return null;
    const value = (aggregateWeighted.value / aggregateTotalWeight.value) * 100;
    return Math.max(0, Math.min(100, value));
  });

  watch(
    [
      () => jobs.value,
      () => jobs.value.length,
      () => queueStructureRevision?.value ?? null,
      () => appSettings.value?.taskbarProgressMode,
      () => appSettings.value?.taskbarProgressScope,
    ],
    () => {
      rebuildAggregate();
    },
    { immediate: true, flush: "sync" },
  );

  /**
   * Check if there are any active (non-terminal) jobs.
   */
  const hasActiveJobs = computed(() => {
    const list = jobs.value;
    if (!list || list.length === 0) return false;
    // 仅把 processing / paused 视为“活跃任务”，避免队列中残留的
    // queued 任务让标题栏进度条长期保持亮起状态。
    return list.some((job) => job.status === "processing" || job.status === "paused");
  });

  // ----- Header Progress Animation Watch -----
  watch([globalTaskbarProgressPercent, hasActiveJobs], ([percent, active]) => {
    const clamped = percent == null ? null : Math.max(0, Math.min(100, percent));
    if (clamped != null && active) {
      headerProgressPercent.value = Math.max(headerProgressPercent.value, clamped);
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
      headerProgressPercent.value = clamped ?? 0;
      headerProgressFading.value = false;
      return;
    }

    if (clamped != null) {
      headerProgressPercent.value = Math.max(headerProgressPercent.value, clamped);
    }

    headerProgressFading.value = true;
    if (headerProgressFadeTimer !== undefined) {
      window.clearTimeout(headerProgressFadeTimer);
    }
    headerProgressFadeTimer = window.setTimeout(() => {
      headerProgressVisible.value = false;
      headerProgressFading.value = false;
      headerProgressPercent.value = 0;
      headerProgressFadeTimer = undefined;
    }, 400); // 缩短淡出时间到400ms
  });

  // ----- Cleanup -----
  const cleanup = () => {
    if (headerProgressFadeTimer !== undefined) {
      window.clearTimeout(headerProgressFadeTimer);
      headerProgressFadeTimer = undefined;
    }
    for (const stop of stopActiveJobWatches) stop();
    stopActiveJobWatches = [];
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
