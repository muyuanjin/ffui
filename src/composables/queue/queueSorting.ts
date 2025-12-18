import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import { compareJobsByField, getJobSortValue } from "./filtering-utils";
import { progressiveMergeSort } from "./progressiveSort";
import type { QueueSortDirection, QueueSortField } from "./useQueueFiltering.types";

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
  sortPrimary: Ref<QueueSortField>;
  sortPrimaryDirection: Ref<QueueSortDirection>;
  sortSecondary: Ref<QueueSortField>;
  sortSecondaryDirection: Ref<QueueSortDirection>;
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
    let result = compareJobsByConfiguredFields(a, b);
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
    const ao = a.queueOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.queueOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;

    let result = compareJobsByConfiguredFields(a, b);
    if (result !== 0) return result;

    const as = a.startTime ?? 0;
    const bs = b.startTime ?? 0;
    if (as !== bs) return as - bs;

    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  };

  // For large queues, compute a first sorted chunk quickly and defer the
  // full ordering via incremental slices, yielding to the main thread so the
  // UI can keep processing input and drag events.
  const displayModeSortedJobsInternal = ref<TranscodeJob[]>([]);

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

  watch(
    [filteredJobs, sortPrimary, sortPrimaryDirection, sortSecondary, sortSecondaryDirection],
    ([jobs]) => {
      if (!jobs || jobs.length === 0) {
        displayModeSortedJobsInternal.value = [];
        cancelLargeQueueSort();
        return;
      }

      const list = jobs.slice();

      if (typeof window === "undefined" || isTestEnv || list.length <= LARGE_QUEUE_SORT_THRESHOLD) {
        // Small/medium lists: keep the simple synchronous sort so behaviour
        // stays predictable and easy to reason about.
        cancelLargeQueueSort();
        displayModeSortedJobsInternal.value = list.sort((a, b) => compareJobsForDisplay(a, b));
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
        },
      });
    },
    { immediate: true },
  );

  const displayModeSortedJobs = computed<TranscodeJob[]>(() => {
    return displayModeSortedJobsInternal.value;
  });

  const manualQueueJobs = computed<TranscodeJob[]>(() => filteredJobs.value.filter((job) => !job.batchId));

  const queueModeProcessingJobs = computed<TranscodeJob[]>(() =>
    manualQueueJobs.value
      .filter((job) => job.status === "processing")
      .slice()
      .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0)),
  );

  const queueModeWaitingJobs = computed<TranscodeJob[]>(() =>
    manualQueueJobs.value
      .filter((job) => job.status === "waiting" || job.status === "queued" || job.status === "paused")
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
