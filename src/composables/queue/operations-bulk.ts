import { type Ref, type ComputedRef } from "vue";
import type { TranscodeJob } from "@/types";
import { hasTauri, reorderQueue } from "@/lib/backend";

/**
 * Bulk operation dependencies.
 */
export interface BulkOpsDeps {
  /** The list of jobs (will be updated by operations). */
  jobs: Ref<TranscodeJob[]>;
  /** Selected job IDs for bulk operations. */
  selectedJobIds: Ref<Set<string>>;
  /** Selected jobs computed ref. */
  selectedJobs: ComputedRef<TranscodeJob[]>;
  /** Queue error message ref. */
  queueError: Ref<string | null>;
  /** Optional i18n translation function. */
  t?: (key: string) => string;
  /** Refresh queue state from backend. */
  refreshQueueFromBackend: () => Promise<void>;
  /** Single job operation handlers. */
  handleCancelJob: (jobId: string) => Promise<void>;
  handleWaitJob: (jobId: string) => Promise<void>;
  handleResumeJob: (jobId: string) => Promise<void>;
  handleRestartJob: (jobId: string) => Promise<void>;
}

// ----- Bulk Operations -----

/**
 * Cancel all selected jobs.
 * Delegates to single job cancel handler for each job.
 */
export async function bulkCancelSelectedJobs(deps: BulkOpsDeps) {
  const ids = Array.from(deps.selectedJobIds.value);
  for (const id of ids) {
    await deps.handleCancelJob(id);
  }
}

/**
 * Wait all selected processing jobs.
 * Only affects jobs with status === "processing".
 */
export async function bulkWaitSelectedJobs(deps: BulkOpsDeps) {
  const ids = deps.selectedJobs.value
    .filter((job) => job.status === "processing")
    .map((job) => job.id);
  for (const id of ids) {
    await deps.handleWaitJob(id);
  }
}

/**
 * Resume all selected paused jobs.
 * Only affects jobs with status === "paused".
 */
export async function bulkResumeSelectedJobs(deps: BulkOpsDeps) {
  const ids = deps.selectedJobs.value
    .filter((job) => job.status === "paused")
    .map((job) => job.id);
  for (const id of ids) {
    await deps.handleResumeJob(id);
  }
}

/**
 * Restart all selected non-completed jobs.
 * Excludes completed and skipped jobs; cancelled jobs are eligible so users
 * can explicitly restart terminated tasks from 0%.
 */
export async function bulkRestartSelectedJobs(deps: BulkOpsDeps) {
  const ids = deps.selectedJobs.value
    .filter(
      (job) =>
        job.status !== "completed" &&
        job.status !== "skipped",
    )
    .map((job) => job.id);
  for (const id of ids) {
    await deps.handleRestartJob(id);
  }
}

// ----- Queue Reordering -----

/**
 * Build ordered IDs of waiting jobs (waiting/queued/paused).
 * Excludes batch jobs (jobs with batchId).
 * Sorts by queueOrder, then startTime, then id.
 */
export function buildWaitingQueueIds(deps: Pick<BulkOpsDeps, "jobs">): string[] {
  const waiting = deps.jobs.value
    .filter(
      (job) =>
        !job.batchId &&
        (job.status === "waiting" ||
          job.status === "queued" ||
          job.status === "paused"),
    )
    .slice()
    .sort((a, b) => {
      const ao = a.queueOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.queueOrder ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      const as = a.startTime ?? 0;
      const bs = b.startTime ?? 0;
      if (as !== bs) return as - bs;
      return a.id.localeCompare(b.id);
    });
  return waiting.map((job) => job.id);
}

/**
 * Reorder the waiting queue locally (non-Tauri mode).
 * Jobs not in orderedIds are appended after explicitly ordered jobs.
 */
function reorderWaitingQueueLocal(orderedIds: string[], deps: Pick<BulkOpsDeps, "jobs">) {
  const waitingIds = buildWaitingQueueIds(deps);
  const explicitSet = new Set(orderedIds);
  const remaining = waitingIds.filter((id) => !explicitSet.has(id));
  const nextOrder = [...orderedIds, ...remaining];

  deps.jobs.value = deps.jobs.value.slice().sort((a, b) => {
    const ai = nextOrder.indexOf(a.id);
    const bi = nextOrder.indexOf(b.id);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

/**
 * Reorder the waiting queue.
 * In Tauri mode, calls backend reorderQueue command and refreshes state.
 * In non-Tauri mode, reorders locally.
 */
export async function reorderWaitingQueue(orderedIds: string[], deps: BulkOpsDeps) {
  if (orderedIds.length === 0) return;

  if (!hasTauri()) {
    reorderWaitingQueueLocal(orderedIds, deps);
    return;
  }

  try {
    const ok = await reorderQueue(orderedIds);
    if (!ok) {
      deps.queueError.value =
        (deps.t?.("queue.error.reorderRejected") as string) ?? "";
      return;
    }
    deps.queueError.value = null;
    await deps.refreshQueueFromBackend();
  } catch (error) {
    console.error("Failed to reorder waiting queue", error);
    deps.queueError.value =
      (deps.t?.("queue.error.reorderFailed") as string) ?? "";
  }
}

/**
 * Move selected waiting jobs to top of queue.
 * Selected jobs are placed first, followed by remaining waiting jobs.
 */
export async function bulkMoveSelectedJobsToTop(deps: BulkOpsDeps) {
  const ids = deps.selectedJobs.value
    .filter((job) =>
      ["waiting", "queued", "paused"].includes(job.status as string),
    )
    .map((job) => job.id);
  if (ids.length === 0) return;

  const waitingIds = buildWaitingQueueIds(deps);
  const selectedSet = new Set(ids);
  const remaining = waitingIds.filter((id) => !selectedSet.has(id));
  const next = [...ids, ...remaining];
  await reorderWaitingQueue(next, deps);
}

/**
 * Move selected waiting jobs to bottom of queue.
 * Unselected jobs are placed first, followed by selected jobs.
 */
export async function bulkMoveSelectedJobsToBottom(deps: BulkOpsDeps) {
  const ids = deps.selectedJobs.value
    .filter((job) =>
      ["waiting", "queued", "paused"].includes(job.status as string),
    )
    .map((job) => job.id);
  if (ids.length === 0) return;

  const waitingIds = buildWaitingQueueIds(deps);
  const selectedSet = new Set(ids);
  const unselected = waitingIds.filter((id) => !selectedSet.has(id));
  const next = [...unselected, ...ids];
  await reorderWaitingQueue(next, deps);
}
