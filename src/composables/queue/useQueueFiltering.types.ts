import type { Ref, ComputedRef } from "vue";
import type { TranscodeJob, CompositeBatchCompressTask, JobStatus } from "@/types";

// ----- Filter & sort types -----

export type QueueFilterStatus = JobStatus;
export type QueueFilterKind = "manual" | "batchCompress";

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

export type QueueListItem = { kind: "batch"; batch: CompositeBatchCompressTask } | { kind: "job"; job: TranscodeJob };

// ----- Composable options & return shape -----

export interface UseQueueFilteringOptions {
  /** The full list of jobs from backend. */
  jobs: Ref<TranscodeJob[]>;
  /** Composite batch compress tasks for batch display. */
  compositeBatchCompressTasks: ComputedRef<CompositeBatchCompressTask[]>;
  /** Map of batch ID to composite task. */
  compositeTasksById: ComputedRef<Map<string, CompositeBatchCompressTask>>;
  /** Optional i18n translation function for error messages. */
  t?: (key: string) => string;
}

export interface UseQueueFilteringReturn {
  // ----- State -----
  /** IDs of selected jobs. */
  selectedJobIds: Ref<Set<string>>;
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
  /** Whether the primary sort field currently has duplicate values among filtered jobs. */
  hasPrimarySortTies: ComputedRef<boolean>;
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
  batchMatchesFilters: (batch: CompositeBatchCompressTask) => boolean;
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
  /** Compare jobs by configured sort fields. */
  compareJobsByConfiguredFields: (a: TranscodeJob, b: TranscodeJob) => number;
  /** Compare jobs for display (with fallbacks). */
  compareJobsForDisplay: (a: TranscodeJob, b: TranscodeJob) => number;
  /** Compare jobs in waiting group (queue order first). */
  compareJobsInWaitingGroup: (a: TranscodeJob, b: TranscodeJob) => number;
}
