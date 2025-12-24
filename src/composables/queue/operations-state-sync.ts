import { type Ref } from "vue";
import type { TranscodeJob, QueueState, QueueStateLite, Translate } from "@/types";
import { hasTauri, loadQueueStateLite } from "@/lib/backend";
import { startupNowMs, updateStartupMetrics } from "@/lib/startupMetrics";
import { perfLog } from "@/lib/perfLog";

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

function syncJobObject(previous: TranscodeJob, next: TranscodeJob) {
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
  const previousById = new Map(previousJobs.map((job) => [job.id, job]));

  const nextJobs: TranscodeJob[] = [];
  for (const backendJob of backendJobs) {
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
  const backendJobs = state.jobs ?? [];

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
}

/**
 * Refresh the queue state from backend.
 * Detects completed jobs and triggers onJobCompleted callback.
 * Clears queue error on success or sets error message on failure.
 */
export async function refreshQueueFromBackend(deps: StateSyncDeps) {
  if (!hasTauri()) return;
  try {
    const previousJobs = deps.jobs.value;
    const startedAt = startupNowMs();
    const state = await loadQueueStateLite();
    const elapsedMs = startupNowMs() - startedAt;
    const backendJobs = (state as QueueStateLite).jobs ?? [];

    if (!isTestEnv && (!loggedQueueRefresh || elapsedMs >= 200)) {
      loggedQueueRefresh = true;
      updateStartupMetrics({ getQueueStateLiteMs: elapsedMs });
      perfLog(`[perf] get_queue_state_lite: ${elapsedMs.toFixed(1)}ms`);
    }

    detectNewlyCompletedJobs(previousJobs, backendJobs, deps.onJobCompleted);
    recomputeJobsFromBackend(backendJobs, deps);
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to refresh queue state", error);
    deps.queueError.value = deps.t?.("queue.error.loadFailed") ?? "";
  }
}
