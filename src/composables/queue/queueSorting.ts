import { computed, shallowRef, triggerRef, watch, type ComputedRef, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import { compareJobsByField, getJobSortValue } from "./filtering-utils";
import { progressiveMergeSort } from "./progressiveSort";
import type { QueueSortDirection, QueueSortField } from "./useQueueFiltering.types";
import { compareJobsInWaitingGroup as compareJobsInWaitingGroupBase } from "./jobStatus";

// Thresholds for progressive sorting of large queues. For small/medium lists
// we keep the simple synchronous sort; for very large lists we first sort a
// small prefix so the UI can render quickly, then sort the full list on a
// deferred tick.
const LARGE_QUEUE_SORT_THRESHOLD = 1000;
const INITIAL_SORT_BATCH_SIZE = 200;
const LARGE_QUEUE_SORT_CHUNK_SIZE = 250;
const LARGE_QUEUE_SORT_YIELD_EVERY_ITEMS = 200;

export interface QueueSortingDeps {
  filteredJobs: ComputedRef<TranscodeJob[]>;
  /** Filtered jobs ignoring status filters (used to always surface processing jobs in queue mode). */
  filteredJobsIgnoringStatus?: ComputedRef<TranscodeJob[]>;
  sortPrimary: Ref<QueueSortField>;
  sortPrimaryDirection: Ref<QueueSortDirection>;
  sortSecondary: Ref<QueueSortField>;
  sortSecondaryDirection: Ref<QueueSortDirection>;
  /** Optional structural revision for the queue (changes only on non-progress updates). */
  queueStructureRevision?: Ref<number | null>;
  /** Optional progress revision used for progress-based sorting. */
  queueProgressRevision?: Ref<number>;
  /**
   * Optional set of job ids whose volatile sort keys changed in the latest
   * backend delta tick. When present, volatile sorting can reorder only those
   * jobs instead of re-sorting the full list on every tick.
   */
  queueVolatileSortDirtyJobIds?: Ref<Set<string>>;
}

export interface QueueSortingState {
  hasPrimarySortTies: ComputedRef<boolean>;
  displayModeSortedJobs: ComputedRef<TranscodeJob[]>;
  manualQueueJobs: ComputedRef<TranscodeJob[]>;
  queueModeProcessingJobs: ComputedRef<TranscodeJob[]>;
  queueModeWaitingJobs: ComputedRef<TranscodeJob[]>;
  compareJobsByConfiguredFields: (a: TranscodeJob, b: TranscodeJob) => number;
  compareJobsForDisplay: (a: TranscodeJob, b: TranscodeJob) => number;
  compareJobsInWaitingGroup: (a: TranscodeJob, b: TranscodeJob) => number;
}

export function createQueueSortingState(deps: QueueSortingDeps): QueueSortingState {
  const { filteredJobs, sortPrimary, sortPrimaryDirection, sortSecondary, sortSecondaryDirection } = deps;

  const isVolatileSortField = (field: QueueSortField): boolean => field === "progress" || field === "elapsed";

  const hasPrimarySortTies = computed(() => {
    const list = filteredJobs.value;
    if (list.length < 2) return false;

    const field = sortPrimary.value;
    const seen = new Set<string>();

    for (const job of list) {
      const raw = getJobSortValue(job, field);
      let key: string;
      if (raw == null) {
        key = "null";
      } else if (typeof raw === "string") {
        key = `s:${raw.toLowerCase()}`;
      } else {
        key = `n:${raw}`;
      }

      if (seen.has(key)) {
        return true;
      }
      seen.add(key);
    }

    return false;
  });

  const compareJobsByConfiguredFields = (a: TranscodeJob, b: TranscodeJob): number => {
    let result = compareJobsByField(a, b, sortPrimary.value, sortPrimaryDirection.value);
    if (result !== 0) return result;
    result = compareJobsByField(a, b, sortSecondary.value, sortSecondaryDirection.value);
    return result;
  };

  const compareJobsForDisplay = (a: TranscodeJob, b: TranscodeJob): number => {
    const result = compareJobsByConfiguredFields(a, b);
    if (result !== 0) return result;

    const ao = a.queueOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.queueOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;

    const as = a.startTime ?? 0;
    const bs = b.startTime ?? 0;
    if (as !== bs) return as - bs;

    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  };

  const compareJobsInWaitingGroup = (a: TranscodeJob, b: TranscodeJob): number => {
    return compareJobsInWaitingGroupBase(a, b, compareJobsByConfiguredFields);
  };

  const volatileSortRevision = computed(() => {
    const primary = sortPrimary.value;
    const secondary = sortSecondary.value;
    if (!isVolatileSortField(primary) && !isVolatileSortField(secondary)) return 0;
    return deps.queueProgressRevision?.value ?? 0;
  });

  const orderingSignature = computed(() => {
    const list = filteredJobs.value;
    if (!list || list.length === 0) return "0:0";

    // Avoid building large fingerprint strings on the UI thread: for large queues
    // this creates unnecessary allocations and GC pressure during startup.
    //
    // When a structural revision is available, it already captures ordering-
    // relevant changes from the backend. In that case we only need a cheap list
    // identity signature so sort recomputation still reacts to filter changes.
    const struct = deps.queueStructureRevision?.value ?? null;
    const hasStruct = typeof struct === "number" && Number.isFinite(struct);
    const primary = sortPrimary.value;
    const secondary = sortSecondary.value;
    const canUseProgressRevision = deps.queueProgressRevision != null;

    let hash = 2166136261;
    for (const job of list) {
      const id = job.id ?? "";
      for (let i = 0; i < id.length; i += 1) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      hash ^= 10; // newline separator
      hash = Math.imul(hash, 16777619);

      if (hasStruct) {
        continue;
      }

      const pv = canUseProgressRevision && isVolatileSortField(primary) ? "" : getJobSortValue(job, primary);
      const sv = canUseProgressRevision && isVolatileSortField(secondary) ? "" : getJobSortValue(job, secondary);

      const qo = job.queueOrder ?? null;
      const st = job.startTime ?? null;

      const parts: Array<string | number | null> = [pv ?? "", sv ?? "", qo, st];
      for (const part of parts) {
        if (part == null) {
          hash ^= 0;
          hash = Math.imul(hash, 16777619);
          hash ^= 31;
          hash = Math.imul(hash, 16777619);
          continue;
        }
        if (typeof part === "number") {
          // Hash a stable text form for numbers.
          const text = Number.isFinite(part) ? part.toString() : "";
          for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          hash ^= 31;
          hash = Math.imul(hash, 16777619);
          continue;
        }
        const text = typeof part === "string" ? part : String(part);
        for (let i = 0; i < text.length; i += 1) {
          hash ^= text.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        hash ^= 31;
        hash = Math.imul(hash, 16777619);
      }
    }

    return `${list.length}:${hash >>> 0}`;
  });

  // For large queues, compute a first sorted chunk quickly and defer the
  // full ordering via incremental slices, yielding to the main thread so the
  // UI can keep processing input and drag events.
  const displayModeSortedJobsInternal = shallowRef<TranscodeJob[]>([]);
  const volatileIndexHintById = new Map<string, number>();

  let cachedFilteredJobsArray: TranscodeJob[] | null = null;
  let cachedFilteredJobsById: Map<string, TranscodeJob> | null = null;

  const getFilteredJobsById = (list: TranscodeJob[]): Map<string, TranscodeJob> => {
    if (cachedFilteredJobsArray === list && cachedFilteredJobsById) return cachedFilteredJobsById;
    cachedFilteredJobsArray = list;
    cachedFilteredJobsById = new Map(list.map((job) => [job.id, job]));
    return cachedFilteredJobsById;
  };

  const findJobIndexHinted = (arr: readonly TranscodeJob[], id: string, job: TranscodeJob): number => {
    const hint = volatileIndexHintById.get(id);
    if (typeof hint === "number" && hint >= 0 && hint < arr.length) {
      if (arr[hint] === job) return hint;
      // Local search around the last known index. Between 100ms ticks a job
      // should not teleport far unless the queue structure changed.
      const MAX_PROBE = 64;
      for (let d = 1; d <= MAX_PROBE; d += 1) {
        const lo = hint - d;
        if (lo >= 0 && arr[lo] === job) return lo;
        const hi = hint + d;
        if (hi < arr.length && arr[hi] === job) return hi;
      }
    }
    return arr.indexOf(job);
  };

  const consumeVolatileDirtyIds = (): string[] => {
    const setRef = deps.queueVolatileSortDirtyJobIds;
    if (!setRef) return [];
    const set = setRef.value;
    if (!set || set.size === 0) return [];
    const ids = Array.from(set);
    set.clear();
    return ids;
  };

  const isTestEnv =
    typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

  const yieldToMainThread = (): Promise<void> => {
    if (typeof window === "undefined") return Promise.resolve();
    return new Promise((resolve) => {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => resolve());
      } else {
        window.setTimeout(() => resolve(), 0);
      }
    });
  };

  let sortRunId = 0;
  const cancelLargeQueueSort = () => {
    sortRunId += 1;
  };

  const findBinaryInsertIndex = (arr: readonly TranscodeJob[], job: TranscodeJob): number => {
    let low = 0;
    let high = arr.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const cmp = compareJobsForDisplay(job, arr[mid] as TranscodeJob);
      if (cmp < 0) {
        high = mid;
      } else {
        // Keep insertion stable by placing after equals.
        low = mid + 1;
      }
    }
    return low;
  };

  const applyVolatileReorderInPlace = (dirtyIds: string[], source: TranscodeJob[]): boolean => {
    const sorted = displayModeSortedJobsInternal.value;
    if (sorted.length !== source.length) return false;

    const byId = getFilteredJobsById(source);

    const uniqueDirtyIds = Array.from(new Set(dirtyIds));
    if (uniqueDirtyIds.length === 0) return true;

    const dirtyIndices: number[] = [];
    for (const id of uniqueDirtyIds) {
      const job = byId.get(id);
      if (!job) return false;
      const idx = findJobIndexHinted(sorted, id, job);
      if (idx < 0) return false;
      if (sorted[idx] !== job) return false;
      dirtyIndices.push(idx);
    }

    // Remove dirty jobs from their old positions.
    dirtyIndices.sort((a, b) => b - a);
    const removed: TranscodeJob[] = [];
    for (const idx of dirtyIndices) {
      removed.push(sorted[idx] as TranscodeJob);
      sorted.splice(idx, 1);
    }

    // Reinsert based on current comparator values.
    removed.sort((a, b) => compareJobsForDisplay(a, b));
    const inserted: Array<{ id: string; index: number }> = [];
    for (const job of removed) {
      const insertAt = findBinaryInsertIndex(sorted, job);
      sorted.splice(insertAt, 0, job);
      inserted.push({ id: job.id, index: insertAt });
      // Adjust previously recorded indices when an insertion happens before them.
      for (let i = 0; i < inserted.length - 1; i += 1) {
        if (insertAt <= inserted[i]!.index) inserted[i]!.index += 1;
      }
    }

    // Refresh index hints for the jobs that actually moved.
    for (const item of inserted) {
      volatileIndexHintById.set(item.id, item.index);
    }
    triggerRef(displayModeSortedJobsInternal);
    return true;
  };

  const sortTriggerKey = computed(() => {
    const primary = sortPrimary.value;
    const primaryDirection = sortPrimaryDirection.value;
    const secondary = sortSecondary.value;
    const secondaryDirection = sortSecondaryDirection.value;
    const structureRevision = deps.queueStructureRevision?.value ?? null;
    const progressRevision = volatileSortRevision.value;
    const signature = orderingSignature.value;
    return `${primary}|${primaryDirection}|${secondary}|${secondaryDirection}|struct=${structureRevision ?? "none"}|progress=${progressRevision}|list=${signature}`;
  });

  watch(
    sortTriggerKey,
    () => {
      const jobs = filteredJobs.value;
      if (!jobs || jobs.length === 0) {
        displayModeSortedJobsInternal.value = [];
        volatileIndexHintById.clear();
        cachedFilteredJobsArray = null;
        cachedFilteredJobsById = null;
        cancelLargeQueueSort();
        return;
      }

      const primary = sortPrimary.value;
      const secondary = sortSecondary.value;
      const volatileSortActive = isVolatileSortField(primary) || isVolatileSortField(secondary);
      const dirtyIds = volatileSortActive ? consumeVolatileDirtyIds() : [];

      if (
        dirtyIds.length > 0 &&
        volatileSortActive &&
        deps.queueProgressRevision != null &&
        typeof window !== "undefined"
      ) {
        cancelLargeQueueSort();
        if (applyVolatileReorderInPlace(dirtyIds, jobs)) {
          return;
        }
      }

      const list = jobs.slice();

      if (
        typeof window === "undefined" ||
        isTestEnv ||
        (!volatileSortActive && list.length <= LARGE_QUEUE_SORT_THRESHOLD)
      ) {
        // Small/medium lists (or tests): keep the simple synchronous sort so
        // behaviour stays predictable and easy to reason about.
        cancelLargeQueueSort();
        displayModeSortedJobsInternal.value = list.sort((a, b) => compareJobsForDisplay(a, b));
        volatileIndexHintById.clear();
        return;
      }

      const runId = (sortRunId += 1);
      void progressiveMergeSort(list, {
        compare: compareJobsForDisplay,
        chunkSize: LARGE_QUEUE_SORT_CHUNK_SIZE,
        initialBatchSize: INITIAL_SORT_BATCH_SIZE,
        yieldEveryItems: LARGE_QUEUE_SORT_YIELD_EVERY_ITEMS,
        yieldFn: yieldToMainThread,
        isCancelled: () => runId !== sortRunId,
        onPartial: (partial) => {
          if (runId !== sortRunId) return;
          displayModeSortedJobsInternal.value = partial;
          volatileIndexHintById.clear();
        },
      });
    },
    { immediate: true },
  );

  const displayModeSortedJobs = computed<TranscodeJob[]>(() => {
    return displayModeSortedJobsInternal.value;
  });

  const manualQueueJobs = computed<TranscodeJob[]>(() => filteredJobs.value.filter((job) => !job.batchId));
  const manualQueueJobsIgnoringStatus = computed<TranscodeJob[]>(() => {
    const source = deps.filteredJobsIgnoringStatus?.value;
    if (!source) return manualQueueJobs.value;
    return source.filter((job) => !job.batchId);
  });

  const queueModeProcessingJobs = computed<TranscodeJob[]>(() =>
    manualQueueJobsIgnoringStatus.value
      .filter((job) => job.status === "processing")
      .slice()
      .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0)),
  );

  const queueModeWaitingJobs = computed<TranscodeJob[]>(() =>
    manualQueueJobs.value
      .filter((job) => job.status === "queued" || job.status === "paused")
      .slice()
      .sort((a, b) => compareJobsInWaitingGroup(a, b)),
  );

  return {
    hasPrimarySortTies,
    displayModeSortedJobs,
    manualQueueJobs,
    queueModeProcessingJobs,
    queueModeWaitingJobs,
    compareJobsByConfiguredFields,
    compareJobsForDisplay,
    compareJobsInWaitingGroup,
  };
}
