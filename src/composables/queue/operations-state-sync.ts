import { type Ref } from "vue";
import type { QueueState, QueueStateLite, QueueStateLiteDelta, TranscodeJob, Translate } from "@/types";
import { hasTauri, loadQueueStateLite } from "@/lib/backend";
import { startupNowMs, updateStartupMetrics } from "@/lib/startupMetrics";
import { perfLog } from "@/lib/perfLog";
import { measureQueueApply } from "@/lib/queuePerf";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

let loggedQueueStateLiteApplied = false;
let loggedQueueRefresh = false;

let firstQueueStateLiteApplied = false;
const FIRST_QUEUE_STATE_LITE_MARK = "first_queue_state_lite_applied";

type StateSyncPerfCounters = {
  syncJobObjectCalls: number;
  recomputeFastPathJobsScanned: number;
  recomputeRebuildJobsScanned: number;
  deltaIndexBuilds: number;
  deltaIndexJobsScanned: number;
};

const stateSyncPerfCounters: StateSyncPerfCounters = {
  syncJobObjectCalls: 0,
  recomputeFastPathJobsScanned: 0,
  recomputeRebuildJobsScanned: 0,
  deltaIndexBuilds: 0,
  deltaIndexJobsScanned: 0,
};

export const __test = {
  resetPerfCounters: () => {
    stateSyncPerfCounters.syncJobObjectCalls = 0;
    stateSyncPerfCounters.recomputeFastPathJobsScanned = 0;
    stateSyncPerfCounters.recomputeRebuildJobsScanned = 0;
    stateSyncPerfCounters.deltaIndexBuilds = 0;
    stateSyncPerfCounters.deltaIndexJobsScanned = 0;
  },
  getPerfCounters: (): StateSyncPerfCounters => ({ ...stateSyncPerfCounters }),
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

type MutableRecord = Record<string, unknown>;

const asMutableRecord = (job: TranscodeJob): MutableRecord => {
  // We intentionally patch job objects in place to preserve identity.
  return job as unknown as MutableRecord;
};

const normalizeLegacyJobStatuses = (jobs: TranscodeJob[]) => {
  for (const job of jobs) {
    const status = (job as unknown as { status?: unknown }).status;
    if (status === "waiting") {
      (job as unknown as { status: unknown }).status = "queued";
    }
  }
};

const refreshInFlightByJobs = new WeakMap<object, Promise<void>>();
const jobIndexCacheByJobsRef = new WeakMap<object, { array: TranscodeJob[]; byId: Map<string, TranscodeJob> }>();
const deltaOrderCacheByJobsRef = new WeakMap<object, { baseSnapshotRevision: number; deltaRevision: number }>();

const getJobIndexForDelta = (jobsRef: Ref<TranscodeJob[]>): Map<string, TranscodeJob> => {
  const key = jobsRef as unknown as object;
  const currentArray = jobsRef.value;
  const cached = jobIndexCacheByJobsRef.get(key);
  if (cached && cached.array === currentArray) {
    return cached.byId;
  }
  if (isTestEnv) {
    stateSyncPerfCounters.deltaIndexBuilds += 1;
    stateSyncPerfCounters.deltaIndexJobsScanned += currentArray.length;
  }
  const byId = new Map(currentArray.map((job) => [job.id, job]));
  jobIndexCacheByJobsRef.set(key, { array: currentArray, byId });
  return byId;
};

const shouldApplyDelta = (delta: QueueStateLiteDelta, deps: StateSyncDeps): boolean => {
  const baseSnapshotRevision = delta?.baseSnapshotRevision;
  const deltaRevision = delta?.deltaRevision;

  if (typeof baseSnapshotRevision !== "number" || !Number.isFinite(baseSnapshotRevision)) return false;
  if (typeof deltaRevision !== "number" || !Number.isFinite(deltaRevision) || deltaRevision < 0) return false;

  const lastSnapshotRevision = deps.lastQueueSnapshotRevision.value;
  if (typeof lastSnapshotRevision !== "number" || !Number.isFinite(lastSnapshotRevision)) return false;
  if (baseSnapshotRevision !== lastSnapshotRevision) return false;

  const key = deps.jobs as unknown as object;
  const cached = deltaOrderCacheByJobsRef.get(key);
  if (!cached || cached.baseSnapshotRevision !== baseSnapshotRevision) {
    deltaOrderCacheByJobsRef.set(key, { baseSnapshotRevision, deltaRevision });
    return true;
  }

  if (deltaRevision <= cached.deltaRevision) return false;
  cached.deltaRevision = deltaRevision;
  return true;
};

const resetDeltaOrderCache = (deps: Pick<StateSyncDeps, "jobs">) => {
  const key = deps.jobs as unknown as object;
  deltaOrderCacheByJobsRef.delete(key);
};

function syncJobObject(previous: TranscodeJob, next: TranscodeJob) {
  if (isTestEnv) {
    stateSyncPerfCounters.syncJobObjectCalls += 1;
  }
  const prevAny = asMutableRecord(previous);
  const nextAny = asMutableRecord(next);

  // Remove properties that are missing from the backend snapshot (treat missing as undefined),
  // ensuring the in-memory job list stays aligned with the backend source of truth.
  for (const key of Object.keys(prevAny)) {
    if (!(key in nextAny)) {
      delete prevAny[key];
    }
  }

  for (const [key, value] of Object.entries(nextAny)) {
    const prevValue = prevAny[key];

    // Preserve array/object references when they are structurally equal to avoid
    // triggering needless component updates.
    if (Array.isArray(prevValue) && Array.isArray(value)) {
      if (prevValue.length === value.length && prevValue.every((v: unknown, idx: number) => v === value[idx])) {
        continue;
      }
    } else if (isObject(prevValue) && isObject(value)) {
      // Common fast-path: if both are plain objects with the same JSON-ish shape,
      // keep the previous reference. This is intentionally shallow to stay cheap.
      const prevKeys = Object.keys(prevValue);
      const nextKeys = Object.keys(value);
      if (
        prevKeys.length === nextKeys.length &&
        prevKeys.every((k) => k in value) &&
        prevKeys.every((k) => prevValue[k] === value[k])
      ) {
        continue;
      }
    }

    if (prevValue !== value) {
      prevAny[key] = value;
    }
  }
}

/**
 * State sync function dependencies.
 */
export interface StateSyncDeps {
  /** The list of jobs (will be updated by operations). */
  jobs: Ref<TranscodeJob[]>;
  /** Queue error message ref. */
  queueError: Ref<string | null>;
  /** Last queue snapshot timestamp. */
  lastQueueSnapshotAtMs: Ref<number | null>;
  /** Last applied monotonic snapshot revision (for ordering / de-dupe). */
  lastQueueSnapshotRevision: Ref<number | null>;
  /** Optional monotonic progress revision (bumps on progress deltas). */
  queueProgressRevision?: Ref<number>;
  /** Optional i18n translation function. */
  t?: Translate;
  /** Callback when a job completes (for preset stats update). */
  onJobCompleted?: (job: TranscodeJob) => void;
}

/**
 * Recompute the jobs list from backend jobs.
 */
export function recomputeJobsFromBackend(backendJobs: TranscodeJob[], deps: Pick<StateSyncDeps, "jobs">) {
  // Backend queue snapshots are the single source of truth:
  // - Do not merge any local "Batch Compress temp queue" entries.
  // - This prevents UI from keeping stale jobs that the backend already removed.
  //
  // For UI smoothness, preserve existing job object identities by id and patch
  // fields in place so unchanged rows don't re-render on every lite snapshot.

  const previousJobs = deps.jobs.value;

  // Fast path: when backend provides the exact same ordering, patch in place
  // without replacing the jobs array reference. This reduces downstream
  // filter/sort recomputations for "log-only" updates while keeping the
  // reactive updates for changed fields themselves.
  if (previousJobs.length === backendJobs.length) {
    let sameOrder = true;
    for (let idx = 0; idx < backendJobs.length; idx += 1) {
      if (previousJobs[idx]?.id !== backendJobs[idx]?.id) {
        sameOrder = false;
        break;
      }
    }

    if (sameOrder) {
      for (let idx = 0; idx < backendJobs.length; idx += 1) {
        if (isTestEnv) {
          stateSyncPerfCounters.recomputeFastPathJobsScanned += 1;
        }
        syncJobObject(previousJobs[idx] as TranscodeJob, backendJobs[idx] as TranscodeJob);
      }
      return;
    }
  }

  const previousById = new Map(previousJobs.map((job) => [job.id, job]));

  const nextJobs: TranscodeJob[] = [];
  for (const backendJob of backendJobs) {
    if (isTestEnv) {
      stateSyncPerfCounters.recomputeRebuildJobsScanned += 1;
    }
    const prev = previousById.get(backendJob.id);
    if (prev) {
      syncJobObject(prev, backendJob);
      nextJobs.push(prev);
      continue;
    }
    nextJobs.push(backendJob);
  }

  deps.jobs.value = nextJobs;
}

/**
 * Detect newly completed jobs by comparing the previous jobs list with the
 * latest backend snapshot, and invoke the onJobCompleted callback for each.
 */
function detectNewlyCompletedJobs(
  previousJobs: TranscodeJob[],
  backendJobs: TranscodeJob[],
  onJobCompleted?: (job: TranscodeJob) => void,
) {
  if (!onJobCompleted) return;

  const previousById = new Map(previousJobs.map((job) => [job.id, job]));

  for (const job of backendJobs) {
    const prev = previousById.get(job.id);
    if (job.status === "completed" && (!prev || prev.status !== "completed")) {
      onJobCompleted(job);
    }
  }
}

/**
 * Apply a full queue state snapshot from the backend.
 * Updates jobs list, records snapshot timestamp, and triggers onJobCompleted
 * for jobs that have newly transitioned into the `completed` state.
 */
export function applyQueueStateFromBackend(state: QueueState | QueueStateLite, deps: StateSyncDeps) {
  measureQueueApply("snapshot", () => {
    const snapshotRevision = (state as unknown as { snapshotRevision?: number }).snapshotRevision;
    if (typeof snapshotRevision === "number" && Number.isFinite(snapshotRevision)) {
      const prev = deps.lastQueueSnapshotRevision.value;
      if (typeof prev === "number" && Number.isFinite(prev) && snapshotRevision < prev) {
        return;
      }
      deps.lastQueueSnapshotRevision.value = snapshotRevision;
      resetDeltaOrderCache(deps);
    }

    const backendJobs = state.jobs ?? [];
    normalizeLegacyJobStatuses(backendJobs);

    if (!firstQueueStateLiteApplied) {
      firstQueueStateLiteApplied = true;
      if (typeof performance !== "undefined" && "mark" in performance) {
        performance.mark(FIRST_QUEUE_STATE_LITE_MARK);
      }
      if (!isTestEnv && !loggedQueueStateLiteApplied) {
        loggedQueueStateLiteApplied = true;
        updateStartupMetrics({ firstQueueStateLiteJobs: backendJobs.length });
        perfLog(`[perf] first QueueStateLite applied: jobs=${backendJobs.length}`);
      }
    }

    const previousJobs = deps.jobs.value;

    detectNewlyCompletedJobs(previousJobs, backendJobs, deps.onJobCompleted);
    recomputeJobsFromBackend(backendJobs, deps);
    deps.lastQueueSnapshotAtMs.value = Date.now();
  });
}

export function applyQueueStateLiteDeltaFromBackend(delta: QueueStateLiteDelta, deps: StateSyncDeps) {
  measureQueueApply("delta", () => {
    if (!shouldApplyDelta(delta, deps)) return;
    const patches = delta?.patches ?? [];
    if (!Array.isArray(patches) || patches.length === 0) return;

    let patchedAny = false;
    let progressUpdated = false;
    const byId = getJobIndexForDelta(deps.jobs);

    for (const patch of patches) {
      const id = patch?.id;
      if (!id) continue;
      const job = byId.get(id);
      if (!job) continue;
      patchedAny = true;

      if (typeof patch.status === "string" && patch.status !== job.status) {
        (job as unknown as { status: string }).status = patch.status;
      }

      if (typeof patch.progress === "number" && Number.isFinite(patch.progress)) {
        const nextProgress = Math.min(100, Math.max(0, patch.progress));
        if (nextProgress !== job.progress) {
          (job as unknown as { progress: number }).progress = nextProgress;
          progressUpdated = true;
        }
      }

      if (typeof patch.elapsedMs === "number" && Number.isFinite(patch.elapsedMs) && patch.elapsedMs >= 0) {
        const current = (job as unknown as { elapsedMs?: number }).elapsedMs;
        if (current !== patch.elapsedMs) {
          (job as unknown as { elapsedMs?: number }).elapsedMs = patch.elapsedMs;
        }
      }

      if (typeof patch.previewPath === "string") {
        const current = (job as unknown as { previewPath?: string }).previewPath;
        if (current !== patch.previewPath) {
          (job as unknown as { previewPath?: string }).previewPath = patch.previewPath;
        }
      }

      if (
        typeof patch.previewRevision === "number" &&
        Number.isFinite(patch.previewRevision) &&
        patch.previewRevision >= 0
      ) {
        const current = (job as unknown as { previewRevision?: number }).previewRevision;
        if (current !== patch.previewRevision) {
          (job as unknown as { previewRevision?: number }).previewRevision = patch.previewRevision;
        }
      }
    }

    if (patchedAny) {
      deps.lastQueueSnapshotAtMs.value = Date.now();
    }
    if (progressUpdated && deps.queueProgressRevision) {
      deps.queueProgressRevision.value += 1;
    }
  });
}

/**
 * Refresh the queue state from backend.
 * Detects completed jobs and triggers onJobCompleted callback.
 * Clears queue error on success or sets error message on failure.
 */
export async function refreshQueueFromBackend(deps: StateSyncDeps) {
  if (!hasTauri()) return;
  const key = deps.jobs as unknown as object;
  const existing = refreshInFlightByJobs.get(key);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    try {
      const previousJobs = deps.jobs.value;
      const startedAt = startupNowMs();
      const state = await loadQueueStateLite();
      const elapsedMs = startupNowMs() - startedAt;
      const backendJobs = (state as QueueStateLite).jobs ?? [];
      const snapshotRevision = (state as unknown as { snapshotRevision?: number }).snapshotRevision;

      if (typeof snapshotRevision === "number" && Number.isFinite(snapshotRevision)) {
        const prev = deps.lastQueueSnapshotRevision.value;
        if (typeof prev === "number" && Number.isFinite(prev) && snapshotRevision < prev) {
          return;
        }
        deps.lastQueueSnapshotRevision.value = snapshotRevision;
        resetDeltaOrderCache(deps);
      }

      if (!isTestEnv && (!loggedQueueRefresh || elapsedMs >= 200)) {
        loggedQueueRefresh = true;
        updateStartupMetrics({ getQueueStateLiteMs: elapsedMs });
        perfLog(`[perf] get_queue_state_lite: ${elapsedMs.toFixed(1)}ms`);
      }

      detectNewlyCompletedJobs(previousJobs, backendJobs, deps.onJobCompleted);
      recomputeJobsFromBackend(backendJobs, deps);
      deps.lastQueueSnapshotAtMs.value = Date.now();
      deps.queueError.value = null;
    } catch (error) {
      console.error("Failed to refresh queue state", error);
      deps.queueError.value = deps.t?.("queue.error.loadFailed") ?? "";
    }
  })();

  refreshInFlightByJobs.set(key, task);
  try {
    await task;
  } finally {
    refreshInFlightByJobs.delete(key);
  }
}
