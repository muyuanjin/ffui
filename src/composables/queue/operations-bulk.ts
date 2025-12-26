import { type Ref, type ComputedRef } from "vue";
import type { TranscodeJob, Translate } from "@/types";
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
  t?: Translate;
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
 * Affects jobs with status === "processing" | "waiting" | "queued".
 */
export async function bulkWaitSelectedJobs(deps: BulkOpsDeps) {
  const ids = deps.selectedJobs.value
    .filter((job) => job.status === "processing" || job.status === "waiting" || job.status === "queued")
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
  const ids = deps.selectedJobs.value.filter((job) => job.status === "paused").map((job) => job.id);
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
    .filter((job) => job.status !== "completed" && job.status !== "skipped")
    .map((job) => job.id);
  for (const id of ids) {
    await deps.handleRestartJob(id);
  }
}

// ----- Queue Reordering -----

const isWaitingStatus = (status: TranscodeJob["status"]) =>
  status === "waiting" || status === "queued" || status === "paused";

function sortWaitingJobs(jobs: TranscodeJob[]): TranscodeJob[] {
  return jobs
    .filter((job) => isWaitingStatus(job.status))
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
}

/**
 * Build ordered IDs of waiting jobs (waiting/queued/paused).
 * Sorts by queueOrder, then startTime, then id.
 */
export function buildWaitingQueueIds(deps: Pick<BulkOpsDeps, "jobs">): string[] {
  return sortWaitingJobs(deps.jobs.value).map((job) => job.id);
}

type WaitingGroupKind = "manual" | "batch";

interface WaitingGroup {
  kind: WaitingGroupKind;
  /** Batch id for Batch Compress groups; undefined for manual jobs. */
  batchId?: string;
  /** Ordered waiting job ids in this group. */
  ids: string[];
}

function buildWaitingGroups(jobs: TranscodeJob[]): WaitingGroup[] {
  const waitingJobs = sortWaitingJobs(jobs);

  const groups: WaitingGroup[] = [];
  const batchIndexById = new Map<string, number>();

  for (const job of waitingJobs) {
    const batchId = job.batchId;
    if (batchId) {
      let index = batchIndexById.get(batchId);
      if (index === undefined) {
        index = groups.length;
        groups.push({ kind: "batch", batchId, ids: [] });
        batchIndexById.set(batchId, index);
      }
      groups[index].ids.push(job.id);
      continue;
    }
    groups.push({ kind: "manual", ids: [job.id] });
  }

  return groups;
}

function flattenGroups(groups: WaitingGroup[]): string[] {
  const result: string[] = [];
  for (const group of groups) {
    result.push(...group.ids);
  }
  return result;
}

async function moveSelectedGroupsToEdge(deps: BulkOpsDeps, edge: "top" | "bottom") {
  const byId = new Map(deps.jobs.value.map((job) => [job.id, job]));
  const groups = buildWaitingGroups(deps.jobs.value);
  const waitingIds = flattenGroups(groups);
  if (waitingIds.length === 0) return;

  const waitingSet = new Set(waitingIds);
  const selectedWaitingIds = deps.selectedJobs.value.map((job) => job.id).filter((id) => waitingSet.has(id));

  if (selectedWaitingIds.length === 0) return;

  const selectedWaitingSet = new Set(selectedWaitingIds);

  const selectedBatchIds = new Set<string>();
  let hasManualSelected = false;

  for (const id of selectedWaitingIds) {
    const job = byId.get(id);
    if (!job) continue;
    if (job.batchId) {
      selectedBatchIds.add(job.batchId);
    } else {
      hasManualSelected = true;
    }
  }

  const isSingleBatchOnly = !hasManualSelected && selectedBatchIds.size === 1;

  if (isSingleBatchOnly) {
    const batchId = Array.from(selectedBatchIds)[0];
    const batchGroup = groups.find((g) => g.kind === "batch" && g.batchId === batchId);
    if (!batchGroup) return;

    const selectedChildren = batchGroup.ids.filter((id) => selectedWaitingSet.has(id));

    const fullBatchSelected = selectedChildren.length === batchGroup.ids.length;
    if (!fullBatchSelected) {
      const remaining = batchGroup.ids.filter((id) => !selectedWaitingSet.has(id));
      batchGroup.ids = edge === "top" ? [...selectedChildren, ...remaining] : [...remaining, ...selectedChildren];

      const next = flattenGroups(groups);
      await reorderWaitingQueue(next, deps);
      return;
    }
  }

  const selectedGroups: WaitingGroup[] = [];
  const unselectedGroups: WaitingGroup[] = [];

  for (const group of groups) {
    if (group.kind === "manual") {
      const id = group.ids[0];
      if (id && selectedWaitingSet.has(id)) {
        selectedGroups.push(group);
      } else {
        unselectedGroups.push(group);
      }
      continue;
    }

    const selectedAnyChild = group.ids.some((id) => selectedWaitingSet.has(id));
    if (selectedAnyChild) {
      selectedGroups.push(group);
    } else {
      unselectedGroups.push(group);
    }
  }

  if (selectedGroups.length === 0) return;

  const nextGroups =
    edge === "top" ? [...selectedGroups, ...unselectedGroups] : [...unselectedGroups, ...selectedGroups];

  const next = flattenGroups(nextGroups);
  await reorderWaitingQueue(next, deps);
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
  const orderIndex = new Map<string, number>(nextOrder.map((id, index) => [id, index]));
  const originalIndex = new Map<string, number>(deps.jobs.value.map((job, index) => [job.id, index]));

  deps.jobs.value = deps.jobs.value.slice().sort((a, b) => {
    const ai = orderIndex.get(a.id);
    const bi = orderIndex.get(b.id);
    if (ai === undefined && bi === undefined) {
      return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
    }
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
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
      deps.queueError.value = deps.t?.("queue.error.reorderRejected") ?? "";
      return;
    }
    deps.queueError.value = null;
    await deps.refreshQueueFromBackend();
  } catch (error) {
    console.error("Failed to reorder waiting queue", error);
    deps.queueError.value = deps.t?.("queue.error.reorderFailed") ?? "";
  }
}

/**
 * Move selected waiting jobs to top of queue.
 * Selected jobs are placed first, followed by remaining waiting jobs.
 */
export async function bulkMoveSelectedJobsToTop(deps: BulkOpsDeps) {
  await moveSelectedGroupsToEdge(deps, "top");
}

/**
 * Move selected waiting jobs to bottom of queue.
 * Unselected jobs are placed first, followed by selected jobs.
 */
export async function bulkMoveSelectedJobsToBottom(deps: BulkOpsDeps) {
  await moveSelectedGroupsToEdge(deps, "bottom");
}
