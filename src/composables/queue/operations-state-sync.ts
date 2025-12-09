import { type Ref } from "vue";
import type { TranscodeJob, QueueState, QueueStateLite } from "@/types";
import { hasTauri, loadQueueStateLite } from "@/lib/backend";

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
  const smartScanJobs = deps.smartScanJobs.value ?? [];

  // 为了兼容早期“前端临时 Smart Scan 队列 + 后端队列合并”的设计，这里仍然
  // 会把 smartScanJobs 拼在后端快照前面，但必须按 id 去重：
  // - 如果某个 Smart Scan 任务已经出现在 backendJobs 中，就以后端快照为准，
  //   避免在每次队列事件到来时成倍复制同一批任务（导致“任务数量无限增长”）。
  if (!smartScanJobs.length) {
    deps.jobs.value = [...backendJobs];
    return;
  }

  const backendIds = new Set(backendJobs.map((job) => job.id));
  const localOnlySmartScanJobs = smartScanJobs.filter((job) => !backendIds.has(job.id));

  deps.jobs.value = [...localOnlySmartScanJobs, ...backendJobs];
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
export function applyQueueStateFromBackend(
  state: QueueState | QueueStateLite,
  deps: StateSyncDeps,
) {
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
    const state = await loadQueueStateLite();
    const backendJobs = (state as QueueStateLite).jobs ?? [];

    detectNewlyCompletedJobs(previousJobs, backendJobs, deps.onJobCompleted);
    recomputeJobsFromBackend(backendJobs, deps);
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to refresh queue state", error);
    deps.queueError.value =
      (deps.t?.("queue.error.loadFailed") as string) ?? "";
  }
}
