import { type Ref } from "vue";
import type { TranscodeJob, QueueState, QueueStateLite } from "@/types";
import { hasTauri, loadQueueStateLite } from "@/lib/backend";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

const startupNowMs = () => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const updateStartupMetrics = (patch: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  const w = window as any;
  const current = w.__FFUI_STARTUP_METRICS__ ?? {};
  w.__FFUI_STARTUP_METRICS__ = Object.assign({}, current, patch);
};

let loggedQueueStateLiteApplied = false;
let loggedQueueRefresh = false;

let firstQueueStateLiteApplied = false;
const FIRST_QUEUE_STATE_LITE_MARK = "first_queue_state_lite_applied";

/**
 * State sync function dependencies.
 */
export interface StateSyncDeps {
  /** The list of jobs (will be updated by operations). */
  jobs: Ref<TranscodeJob[]>;
  /** Batch Compress jobs to merge with backend jobs. */
  batchCompressJobs: Ref<TranscodeJob[]>;
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
 * Recompute the jobs list from backend jobs, merging with batch compress jobs.
 * Backend jobs are appended after batch compress jobs to maintain scan batch grouping.
 */
export function recomputeJobsFromBackend(
  backendJobs: TranscodeJob[],
  deps: Pick<StateSyncDeps, "jobs" | "batchCompressJobs">,
) {
  // 现在后端队列快照是唯一事实来源：
  // - 任何“本地 Batch Compress 临时队列”都不再与后端快照合并，
  // - 这样可以避免后端已经删除 Batch Compress 子任务但前端仍残留的 UI 不一致问题。
  //
  // batchCompressJobs 仍保留在依赖中，仅为向后兼容接口签名和未来扩展。
  void deps.batchCompressJobs;

  deps.jobs.value = [...backendJobs];
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
      console.log(`[perf] first QueueStateLite applied: jobs=${backendJobs.length}`);
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
      console.log(`[perf] get_queue_state_lite: ${elapsedMs.toFixed(1)}ms`);
    }

    detectNewlyCompletedJobs(previousJobs, backendJobs, deps.onJobCompleted);
    recomputeJobsFromBackend(backendJobs, deps);
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to refresh queue state", error);
    deps.queueError.value = (deps.t?.("queue.error.loadFailed") as string) ?? "";
  }
}
