import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import { compareJobsByField, getJobSortValue } from "./filtering-utils";
import type {
  QueueSortDirection,
  QueueSortField,
} from "./useQueueFiltering.types";

// Thresholds for progressive sorting of large queues. For small/medium lists
// we keep the simple synchronous sort; for very large lists we first sort a
// small prefix so the UI can render quickly, then sort the full list on a
// deferred tick.
const LARGE_QUEUE_SORT_THRESHOLD = 1000;
const INITIAL_SORT_BATCH_SIZE = 200;

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

export function createQueueSortingState(
  deps: QueueSortingDeps,
): QueueSortingState {
  const {
    filteredJobs,
    sortPrimary,
    sortPrimaryDirection,
    sortSecondary,
    sortSecondaryDirection,
  } = deps;

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
    let result = compareJobsByField(
      a,
      b,
      sortPrimary.value,
      sortPrimaryDirection.value,
    );
    if (result !== 0) return result;
    result = compareJobsByField(
      a,
      b,
      sortSecondary.value,
      sortSecondaryDirection.value,
    );
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
  // full sort to the next tick so the UI can render an initial list without
  // being blocked by a single long-running sort over thousands of items.
  const displayModeSortedJobsInternal = ref<TranscodeJob[]>([]);
  let fullSortTimer: number | undefined;

  const cancelFullSortTimer = () => {
    if (typeof window === "undefined") return;
    if (fullSortTimer !== undefined) {
      window.clearTimeout(fullSortTimer);
      fullSortTimer = undefined;
    }
  };

  const scheduleFullSort = () => {
    if (typeof window === "undefined") {
      // No browser timers available (e.g. SSR); fall back to a single
      // synchronous sort based on the latest filteredJobs snapshot.
      const snapshot = filteredJobs.value;
      displayModeSortedJobsInternal.value = snapshot
        .slice()
        .sort((a, b) => compareJobsForDisplay(a, b));
      return;
    }

    cancelFullSortTimer();
    fullSortTimer = window.setTimeout(() => {
      fullSortTimer = undefined;
      const snapshot = filteredJobs.value;
      if (!snapshot || snapshot.length === 0) {
        displayModeSortedJobsInternal.value = [];
        return;
      }
      displayModeSortedJobsInternal.value = snapshot
        .slice()
        .sort((a, b) => compareJobsForDisplay(a, b));
    }, 0);
  };

  watch(
    [filteredJobs, sortPrimary, sortPrimaryDirection, sortSecondary, sortSecondaryDirection],
    ([jobs]) => {
      if (!jobs || jobs.length === 0) {
        displayModeSortedJobsInternal.value = [];
        cancelFullSortTimer();
        return;
      }

      const list = jobs.slice();

      if (
        typeof window === "undefined" ||
        list.length <= LARGE_QUEUE_SORT_THRESHOLD
      ) {
        // Small/medium lists: keep the simple synchronous sort so behaviour
        // stays predictable and easy to reason about.
        cancelFullSortTimer();
        displayModeSortedJobsInternal.value = list.sort((a, b) =>
          compareJobsForDisplay(a, b),
        );
        return;
      }

      // Large lists: sort and expose an initial batch so that the first
      // render remains responsive, then schedule a full sort on the next
      // tick to progressively fill in the rest of the list.
      const initial = list.slice(0, INITIAL_SORT_BATCH_SIZE);
      displayModeSortedJobsInternal.value = initial.sort((a, b) =>
        compareJobsForDisplay(a, b),
      );
      scheduleFullSort();
    },
    { immediate: true },
  );

  const displayModeSortedJobs = computed<TranscodeJob[]>(() => {
    return displayModeSortedJobsInternal.value;
  });

  const manualQueueJobs = computed<TranscodeJob[]>(() =>
    filteredJobs.value.filter((job) => !job.batchId),
  );

  const queueModeProcessingJobs = computed<TranscodeJob[]>(() =>
    manualQueueJobs.value
      .filter((job) => job.status === "processing")
      .slice()
      .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0)),
  );

  const queueModeWaitingJobs = computed<TranscodeJob[]>(() =>
    manualQueueJobs.value
      .filter(
        (job) =>
          job.status === "waiting" ||
          job.status === "queued" ||
          job.status === "paused",
      )
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

