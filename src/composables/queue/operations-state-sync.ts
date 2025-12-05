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
 * Apply a full queue state snapshot from the backend.
 * Updates jobs list and records snapshot timestamp.
 */
export function applyQueueStateFromBackend(state: QueueState, deps: StateSyncDeps) {
  recomputeJobsFromBackend(state.jobs, deps);
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
    const previousById = new Map(previousJobs.map((job) => [job.id, job]));
    const state = await loadQueueState();
    const backendJobs = state.jobs ?? [];

    for (const job of backendJobs) {
      const prev = previousById.get(job.id);
      if (job.status === "completed" && (!prev || prev.status !== "completed")) {
        deps.onJobCompleted?.(job);
      }
    }

    recomputeJobsFromBackend(backendJobs, deps);
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to refresh queue state", error);
    deps.queueError.value =
      deps.t?.("queue.error.loadFailed") ||
      "队列状态刷新失败，可能是后端未运行或外部工具初始化失败。请检查「软件设置」中的路径与自动下载配置。";
  }
}
