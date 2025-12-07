import { type Ref } from "vue";
import type { TranscodeJob, QueueState } from "@/types";
import { hasTauri, loadQueueState } from "@/lib/backend";

/**
 * State sync function dependencies.
 */
export interface StateSyncDeps {
  /** The list of jobs (will be updated by operations). */
  jobs: Ref<TranscodeJob[]>;
  /** Smart scan jobs to merge with backend jobs. */
  smartScanJobs: Ref<TranscodeJob[]>;
  /** Queue error message ref. */
  queueError: Ref<string | null>;
  /** Last queue snapshot timestamp. */
  lastQueueSnapshotAtMs: Ref<number | null>;
  /** Optional i18n translation function. */
  t?: (key: string) => string;
  /** Callback when a job completes (for preset stats update). */
  onJobCompleted?: (job: TranscodeJob) => void;
}

/**
 * Recompute the jobs list from backend jobs, merging with smart scan jobs.
 * Backend jobs are appended after smart scan jobs to maintain scan batch grouping.
 */
export function recomputeJobsFromBackend(
  backendJobs: TranscodeJob[],
  deps: Pick<StateSyncDeps, "jobs" | "smartScanJobs">,
) {
  deps.jobs.value = [...deps.smartScanJobs.value, ...backendJobs];
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
export function applyQueueStateFromBackend(state: QueueState, deps: StateSyncDeps) {
  const backendJobs = state.jobs ?? [];
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
    const state = await loadQueueState();
    const backendJobs = state.jobs ?? [];

    detectNewlyCompletedJobs(previousJobs, backendJobs, deps.onJobCompleted);
    recomputeJobsFromBackend(backendJobs, deps);
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to refresh queue state", error);
    deps.queueError.value =
      (deps.t?.("queue.error.loadFailed") as string) ?? "";
  }
}
