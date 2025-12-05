import { computed, ref, watch, type Ref, type ComputedRef } from "vue";
import type { TranscodeJob, CompositeSmartScanTask, JobStatus } from "@/types";

// ----- Types -----

export type QueueFilterStatus = JobStatus;
export type QueueFilterKind = "manual" | "smartScan";

export type QueueSortField =
  | "filename"
  | "status"
  | "addedTime"
  | "finishedTime"
  | "duration"
  | "elapsed"
  | "progress"
  | "type"
  | "path"
  | "inputSize"
  | "outputSize"
  | "createdTime"
  | "modifiedTime";

export type QueueSortDirection = "asc" | "desc";

export type QueueListItem =
  | { kind: "batch"; batch: CompositeSmartScanTask }
  | { kind: "job"; job: TranscodeJob };

// ----- Helper Functions -----

/**
 * Compare two primitive values for sorting.
 */
export const comparePrimitive = (
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): number => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  if (typeof a === "string" && typeof b === "string") {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    if (al < bl) return -1;
    if (al > bl) return 1;
    return 0;
  }

  const na = typeof a === "number" ? a : Number(a);
  const nb = typeof b === "number" ? b : Number(b);
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
};

/**
 * Get the sortable value for a job by field.
 */
export const getJobSortValue = (job: TranscodeJob, field: QueueSortField) => {
  switch (field) {
    case "filename": {
      const raw = job.inputPath || job.filename || "";
      const normalized = raw.replace(/\\/g, "/");
      const lastSlash = normalized.lastIndexOf("/");
      const name = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
      return name || null;
    }
    case "status":
      return job.status;
    case "addedTime":
      // For now we treat startTime as the "added to queue" timestamp.
      return job.startTime ?? null;
    case "finishedTime":
      return job.endTime ?? null;
    case "duration":
      return job.mediaInfo?.durationSeconds ?? null;
    case "elapsed":
      if (job.startTime && job.endTime && job.endTime > job.startTime) {
        return job.endTime - job.startTime;
      }
      return null;
    case "progress":
      return typeof job.progress === "number" ? job.progress : null;
    case "type":
      return job.type;
    case "path":
      return job.inputPath || job.filename || null;
    case "inputSize":
      return job.originalSizeMB ?? null;
    case "outputSize":
      return job.outputSizeMB ?? null;
    case "createdTime":
    case "modifiedTime":
      // Filesystem timestamps are not yet tracked; keep these as stable
      // placeholders so sort configs remain forward-compatible.
      return null;
    default:
      return null;
  }
};

/**
 * Compare two jobs by a specific field and direction.
 */
export const compareJobsByField = (
  a: TranscodeJob,
  b: TranscodeJob,
  field: QueueSortField,
  direction: QueueSortDirection,
): number => {
  const av = getJobSortValue(a, field);
  const bv = getJobSortValue(b, field);
  let result = comparePrimitive(av, bv);
  if (direction === "desc") {
    result = -result;
  }
  return result;
};

// ----- Composable -----

export interface UseQueueFilteringOptions {
  /** The full list of jobs from backend. */
  jobs: Ref<TranscodeJob[]>;
  /** Composite smart scan tasks for batch display. */
  compositeSmartScanTasks: ComputedRef<CompositeSmartScanTask[]>;
  /** Map of batch ID to composite task. */
  compositeTasksById: ComputedRef<Map<string, CompositeSmartScanTask>>;
  /** Optional i18n translation function for error messages. */
  t?: (key: string) => string;
}

export interface UseQueueFilteringReturn {
  // ----- State -----
  /** IDs of selected jobs. */
  selectedJobIds: Ref<Set<string>>;
  /** IDs of hidden (soft-deleted) jobs. */
  hiddenJobIds: Ref<Set<string>>;
  /** Active status filters. */
  activeStatusFilters: Ref<Set<QueueFilterStatus>>;
  /** Active type filters. */
  activeTypeFilters: Ref<Set<QueueFilterKind>>;
  /** Text filter input. */
  filterText: Ref<string>;
  /** Whether regex mode is enabled. */
  filterUseRegex: Ref<boolean>;
  /** Regex validation error message. */
  filterRegexError: Ref<string | null>;
  /** Compiled filter regex. */
  filterRegex: Ref<RegExp | null>;
  /** Primary sort field. */
  sortPrimary: Ref<QueueSortField>;
  /** Primary sort direction. */
  sortPrimaryDirection: Ref<QueueSortDirection>;
  /** Secondary sort field. */
  sortSecondary: Ref<QueueSortField>;
  /** Secondary sort direction. */
  sortSecondaryDirection: Ref<QueueSortDirection>;

  // ----- Computed -----
  /** Whether any filters are active. */
  hasActiveFilters: ComputedRef<boolean>;
  /** Whether any jobs are selected. */
  hasSelection: ComputedRef<boolean>;
  /** List of selected jobs. */
  selectedJobs: ComputedRef<TranscodeJob[]>;
  /** Filtered jobs list. */
  filteredJobs: ComputedRef<TranscodeJob[]>;
  /** Display mode sorted jobs. */
  displayModeSortedJobs: ComputedRef<TranscodeJob[]>;
  /** Manual queue jobs (no batch). */
  manualQueueJobs: ComputedRef<TranscodeJob[]>;
  /** Processing jobs for queue mode. */
  queueModeProcessingJobs: ComputedRef<TranscodeJob[]>;
  /** Waiting jobs for queue mode. */
  queueModeWaitingJobs: ComputedRef<TranscodeJob[]>;

  // ----- Methods -----
  /** Check if a job matches current filters. */
  jobMatchesFilters: (job: TranscodeJob) => boolean;
  /** Check if a batch matches current filters. */
  batchMatchesFilters: (batch: CompositeSmartScanTask) => boolean;
  /** Check if a job is selected. */
  isJobSelected: (jobId: string) => boolean;
  /** Toggle job selection. */
  toggleJobSelected: (jobId: string) => void;
  /** Clear all selections. */
  clearSelection: () => void;
  /** Select all visible jobs. */
  selectAllVisibleJobs: () => void;
  /** Invert current selection. */
  invertSelection: () => void;
  /** Toggle a status filter. */
  toggleStatusFilter: (status: QueueFilterStatus) => void;
  /** Toggle a type filter. */
  toggleTypeFilter: (kind: QueueFilterKind) => void;
  /** Reset all filters. */
  resetQueueFilters: () => void;
  /** Toggle regex filter mode. */
  toggleFilterRegexMode: () => void;
  /** Hide jobs by IDs (soft delete). */
  hideJobsById: (ids: string[]) => void;
  /** Compare jobs by configured sort fields. */
  compareJobsByConfiguredFields: (a: TranscodeJob, b: TranscodeJob) => number;
  /** Compare jobs for display (with fallbacks). */
  compareJobsForDisplay: (a: TranscodeJob, b: TranscodeJob) => number;
  /** Compare jobs in waiting group (queue order first). */
  compareJobsInWaitingGroup: (a: TranscodeJob, b: TranscodeJob) => number;
}

/**
 * Composable for queue filtering, sorting, and selection.
 */
export function useQueueFiltering(options: UseQueueFilteringOptions): UseQueueFilteringReturn {
  const { jobs, t } = options;

  // ----- State -----
  const selectedJobIds = ref<Set<string>>(new Set());
  const hiddenJobIds = ref<Set<string>>(new Set());
  const activeStatusFilters = ref<Set<QueueFilterStatus>>(new Set());
  const activeTypeFilters = ref<Set<QueueFilterKind>>(new Set());
  const filterText = ref("");
  const filterUseRegex = ref(false);
  const filterRegexError = ref<string | null>(null);
  const filterRegex = ref<RegExp | null>(null);
  let lastValidFilterRegex: RegExp | null = null;

  const sortPrimary = ref<QueueSortField>("addedTime");
  const sortPrimaryDirection = ref<QueueSortDirection>("asc");
  const sortSecondary = ref<QueueSortField>("filename");
  const sortSecondaryDirection = ref<QueueSortDirection>("asc");

  // ----- Regex Validation Watch -----
  watch(
    [filterText, filterUseRegex],
    ([pattern, useRegex]) => {
      const text = (pattern ?? "").trim();
      if (!useRegex || !text) {
        filterRegex.value = null;
        filterRegexError.value = null;
        lastValidFilterRegex = null;
        return;
      }

      try {
        const rx = new RegExp(text, "i");
        filterRegex.value = rx;
        filterRegexError.value = null;
        lastValidFilterRegex = rx;
      } catch {
        filterRegexError.value =
          t?.("queue.filters.invalidRegex") ||
          "无效的正则表达式，已保留上一次有效筛选。";
        // Keep using the last valid regex (if any) so the UI remains stable.
        filterRegex.value = lastValidFilterRegex;
      }
    },
    { flush: "sync" },
  );

  // ----- Computed -----
  const hasActiveFilters = computed(() => {
    if (activeStatusFilters.value.size > 0) return true;
    if (activeTypeFilters.value.size > 0) return true;
    const text = filterText.value.trim();
    if (!text) return false;
    return true;
  });

  const hasSelection = computed(() => selectedJobIds.value.size > 0);

  const selectedJobs = computed<TranscodeJob[]>(() => {
    const byId = new Map(jobs.value.map((job) => [job.id, job]));
    const result: TranscodeJob[] = [];
    for (const id of selectedJobIds.value) {
      const job = byId.get(id);
      if (job) result.push(job);
    }
    return result;
  });

  // ----- Filter Methods -----
  const jobMatchesFilters = (job: TranscodeJob): boolean => {
    // Soft-deleted jobs are never shown again in the UI.
    if (hiddenJobIds.value.has(job.id)) {
      return false;
    }

    if (activeStatusFilters.value.size > 0) {
      if (!activeStatusFilters.value.has(job.status as QueueFilterStatus)) {
        return false;
      }
    }

    if (activeTypeFilters.value.size > 0) {
      const kind: QueueFilterKind =
        job.source === "smart_scan" ? "smartScan" : "manual";
      if (!activeTypeFilters.value.has(kind)) {
        return false;
      }
    }

    const text = filterText.value.trim();
    if (!text) {
      return true;
    }

    const haystack = (job.inputPath || job.filename || "").toLowerCase();
    if (!haystack) return false;

    if (filterUseRegex.value) {
      const rx = filterRegex.value;
      if (!rx) {
        // When the regex is invalid and no previous valid regex exists, keep
        // the list stable instead of dropping all rows.
        return true;
      }
      return rx.test(haystack);
    }

    return haystack.includes(text.toLowerCase());
  };

  const batchMatchesFilters = (batch: CompositeSmartScanTask): boolean => {
    // When no filters are active, include batches that still have visible jobs.
    if (!hasActiveFilters.value) {
      return true;
    }

    // If any child job matches the current filters, surface the batch.
    if (batch.jobs.some((job) => jobMatchesFilters(job))) {
      return true;
    }

    // Fall back to rootPath text matching so users can filter by directory.
    const text = filterText.value.trim();
    if (!text) return false;

    const root = (batch.rootPath || "").toLowerCase();
    if (!root) return false;

    if (filterUseRegex.value) {
      const rx = filterRegex.value;
      if (!rx) return false;
      return rx.test(root);
    }

    return root.includes(text.toLowerCase());
  };

  const filteredJobs = computed<TranscodeJob[]>(() => {
    return jobs.value.filter((job) => jobMatchesFilters(job));
  });

  // ----- Sort Methods -----
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

  const displayModeSortedJobs = computed<TranscodeJob[]>(() => {
    const list = filteredJobs.value.slice();
    if (list.length === 0) return list;
    return list.sort((a, b) => compareJobsForDisplay(a, b));
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

  // ----- Selection Methods -----
  const isJobSelected = (jobId: string): boolean => {
    return selectedJobIds.value.has(jobId);
  };

  const toggleJobSelected = (jobId: string) => {
    if (!jobId) return;
    const next = new Set(selectedJobIds.value);
    if (next.has(jobId)) {
      next.delete(jobId);
    } else {
      next.add(jobId);
    }
    selectedJobIds.value = next;
  };

  const clearSelection = () => {
    if (selectedJobIds.value.size === 0) return;
    selectedJobIds.value = new Set();
  };

  const selectAllVisibleJobs = () => {
    const ids = filteredJobs.value.map((job) => job.id);
    selectedJobIds.value = new Set(ids);
  };

  const invertSelection = () => {
    const visibleIds = new Set(filteredJobs.value.map((job) => job.id));
    const next = new Set<string>();
    for (const id of visibleIds) {
      if (!selectedJobIds.value.has(id)) {
        next.add(id);
      }
    }
    selectedJobIds.value = next;
  };

  // ----- Filter Toggle Methods -----
  const toggleStatusFilter = (status: QueueFilterStatus) => {
    const next = new Set(activeStatusFilters.value);
    if (next.has(status)) {
      next.delete(status);
    } else {
      next.add(status);
    }
    activeStatusFilters.value = next;
  };

  const toggleTypeFilter = (kind: QueueFilterKind) => {
    const next = new Set(activeTypeFilters.value);
    if (next.has(kind)) {
      next.delete(kind);
    } else {
      next.add(kind);
    }
    activeTypeFilters.value = next;
  };

  const resetQueueFilters = () => {
    activeStatusFilters.value = new Set();
    activeTypeFilters.value = new Set();
    filterText.value = "";
    filterUseRegex.value = false;
    filterRegexError.value = null;
    filterRegex.value = null;
    lastValidFilterRegex = null;
  };

  const toggleFilterRegexMode = () => {
    filterUseRegex.value = !filterUseRegex.value;
  };

  const hideJobsById = (ids: string[]) => {
    if (ids.length === 0) return;

    const nextHidden = new Set(hiddenJobIds.value);
    let hiddenChanged = false;
    for (const id of ids) {
      if (!nextHidden.has(id)) {
        nextHidden.add(id);
        hiddenChanged = true;
      }
    }
    if (hiddenChanged) {
      hiddenJobIds.value = nextHidden;
    }

    const nextSelected = new Set(selectedJobIds.value);
    let selectionChanged = false;
    for (const id of ids) {
      if (nextSelected.delete(id)) {
        selectionChanged = true;
      }
    }
    if (selectionChanged) {
      selectedJobIds.value = nextSelected;
    }
  };

  return {
    // State
    selectedJobIds,
    hiddenJobIds,
    activeStatusFilters,
    activeTypeFilters,
    filterText,
    filterUseRegex,
    filterRegexError,
    filterRegex,
    sortPrimary,
    sortPrimaryDirection,
    sortSecondary,
    sortSecondaryDirection,

    // Computed
    hasActiveFilters,
    hasSelection,
    selectedJobs,
    filteredJobs,
    displayModeSortedJobs,
    manualQueueJobs,
    queueModeProcessingJobs,
    queueModeWaitingJobs,

    // Methods
    jobMatchesFilters,
    batchMatchesFilters,
    isJobSelected,
    toggleJobSelected,
    clearSelection,
    selectAllVisibleJobs,
    invertSelection,
    toggleStatusFilter,
    toggleTypeFilter,
    resetQueueFilters,
    toggleFilterRegexMode,
    hideJobsById,
    compareJobsByConfiguredFields,
    compareJobsForDisplay,
    compareJobsInWaitingGroup,
  };
}

export default useQueueFiltering;
