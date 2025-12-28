import { type Ref } from "vue";
import type { QueueState, QueueStateLite, QueueStateLiteDelta, TranscodeJob, Translate } from "@/types";
import { hasTauri, loadQueueStateLite } from "@/lib/backend";
import { startupNowMs, updateStartupMetrics } from "@/lib/startupMetrics";
import { perfLog } from "@/lib/perfLog";
import { measureQueueApply } from "@/lib/queuePerf";
import { stateSyncPerf } from "./operations-state-sync.perf";

export { __test } from "./operations-state-sync.perf";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

let loggedQueueStateLiteApplied = false;
let loggedQueueRefresh = false;

let firstQueueStateLiteApplied = false;
const FIRST_QUEUE_STATE_LITE_MARK = "first_queue_state_lite_applied";

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

type MutableRecord = Record<string, unknown>;

const asMutableRecord = (job: TranscodeJob): MutableRecord => {
  // We intentionally patch job objects in place to preserve identity.
  return job as unknown as MutableRecord;
};

const hasOwnProperty = Object.prototype.hasOwnProperty;

const shallowEqualRecord = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
  let aKeys = 0;
  let bKeys = 0;

  for (const key in a) {
    if (!hasOwnProperty.call(a, key)) continue;
    aKeys += 1;
    if (!hasOwnProperty.call(b, key)) return false;
    if (a[key] !== b[key]) return false;
  }

  for (const key in b) {
    if (!hasOwnProperty.call(b, key)) continue;
    bKeys += 1;
  }

  return aKeys === bKeys;
};

const JOB_KEYS_OPTIONALLY_OMITTED_BY_BACKEND = ["outputPolicy", "runs", "warnings", "previewRevision"] as const;

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
    stateSyncPerf.recordDeltaIndexBuild(currentArray.length);
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
    stateSyncPerf.recordSyncJobObject(1);
  }
  const prevAny = asMutableRecord(previous);
  const nextAny = asMutableRecord(next);

  const shouldSweepMissingKeys =
    ("logs" in prevAny && !("logs" in nextAny)) || ("runs" in prevAny && !("runs" in nextAny));

  for (const key in nextAny) {
    const value = nextAny[key];
    const prevValue = prevAny[key];

    if (prevValue === value) continue;

    // Preserve array/object references when they are structurally equal to avoid
    // triggering needless component updates.
    if (Array.isArray(prevValue) && Array.isArray(value)) {
      if (prevValue.length === value.length) {
        let allEqual = true;
        for (let idx = 0; idx < prevValue.length; idx += 1) {
          if (prevValue[idx] !== value[idx]) {
            allEqual = false;
            break;
          }
        }
        if (allEqual) {
          continue;
        }
      }
    } else if (isObject(prevValue) && isObject(value)) {
      // Common fast-path: if both are plain objects with the same JSON-ish shape,
      // keep the previous reference. This is intentionally shallow to stay cheap.
      if (shallowEqualRecord(prevValue, value)) {
        continue;
      }
    }

    prevAny[key] = value;
  }

  // Some fields are intentionally omitted from backend snapshots when empty/zero.
  // Clear these if a prior snapshot had a value but the current one omits them.
  for (const key of JOB_KEYS_OPTIONALLY_OMITTED_BY_BACKEND) {
    if (key in prevAny && !(key in nextAny)) {
      delete prevAny[key];
    }
  }

  if (shouldSweepMissingKeys) {
    for (const key in prevAny) {
      if (!(key in nextAny)) {
        delete prevAny[key];
      }
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
  /**
   * Optional set of job ids that were patched for volatile sort keys
   * (progress/elapsed) during the current delta tick.
   */
  queueVolatileSortDirtyJobIds?: Ref<Set<string>>;
  /**
   * Optional runtime flag: only track volatile (progress/elapsed) dirty ids when
   * the UI is currently sorting by a volatile field. This prevents unbounded
   * growth when sorting by stable fields.
   */
  trackVolatileSortDirtyJobIds?: Ref<boolean>;
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
          stateSyncPerf.recordRecomputeFastPathScan(1);
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
      stateSyncPerf.recordRecomputeRebuildScan(1);
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
    let volatileSortUpdated = false;
    const byId = getJobIndexForDelta(deps.jobs);
    const volatileDirtyIds = deps.queueVolatileSortDirtyJobIds?.value;
    const trackVolatileDirtyIds = deps.trackVolatileSortDirtyJobIds?.value ?? true;
    if (!trackVolatileDirtyIds) {
      volatileDirtyIds?.clear();
    }

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
          volatileSortUpdated = true;
          if (trackVolatileDirtyIds) volatileDirtyIds?.add(id);
        }
      }

      const hasProgressTelemetry =
        (typeof patch.progressOutTimeSeconds === "number" && Number.isFinite(patch.progressOutTimeSeconds)) ||
        (typeof patch.progressSpeed === "number" && Number.isFinite(patch.progressSpeed)) ||
        (typeof patch.progressUpdatedAtMs === "number" && Number.isFinite(patch.progressUpdatedAtMs)) ||
        (typeof patch.progressEpoch === "number" && Number.isFinite(patch.progressEpoch));

      if (hasProgressTelemetry) {
        const meta = (job as unknown as { waitMetadata?: Record<string, unknown> }).waitMetadata ?? {};
        (job as unknown as { waitMetadata?: Record<string, unknown> }).waitMetadata = meta;

        if (
          typeof patch.progressOutTimeSeconds === "number" &&
          Number.isFinite(patch.progressOutTimeSeconds) &&
          patch.progressOutTimeSeconds >= 0
        ) {
          meta.lastProgressOutTimeSeconds = patch.progressOutTimeSeconds;
        }
        if (
          typeof patch.progressSpeed === "number" &&
          Number.isFinite(patch.progressSpeed) &&
          patch.progressSpeed > 0
        ) {
          meta.lastProgressSpeed = patch.progressSpeed;
        }
        if (
          typeof patch.progressUpdatedAtMs === "number" &&
          Number.isFinite(patch.progressUpdatedAtMs) &&
          patch.progressUpdatedAtMs >= 0
        ) {
          meta.lastProgressUpdatedAtMs = patch.progressUpdatedAtMs;
        }
        if (
          typeof patch.progressEpoch === "number" &&
          Number.isFinite(patch.progressEpoch) &&
          patch.progressEpoch >= 0
        ) {
          meta.progressEpoch = patch.progressEpoch;
        }
      }

      if (typeof patch.elapsedMs === "number" && Number.isFinite(patch.elapsedMs) && patch.elapsedMs >= 0) {
        const current = (job as unknown as { elapsedMs?: number }).elapsedMs;
        if (current !== patch.elapsedMs) {
          (job as unknown as { elapsedMs?: number }).elapsedMs = patch.elapsedMs;
          volatileSortUpdated = true;
          if (trackVolatileDirtyIds) volatileDirtyIds?.add(id);
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
    if (volatileSortUpdated && deps.queueProgressRevision && trackVolatileDirtyIds) {
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
