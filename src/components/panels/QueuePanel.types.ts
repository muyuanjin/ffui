import type {
  CompositeBatchCompressTask,
  FFmpegPreset,
  QueueMode,
  QueueProgressStyle,
  QueueViewMode,
  TranscodeJob,
} from "@/types";
import type {
  QueueFilterKind,
  QueueFilterStatus,
  QueueListItem,
  QueueSortDirection,
  QueueSortField,
} from "@/composables";

export interface QueuePanelProps {
  // Queue items
  queueJobsForDisplay: TranscodeJob[];
  visibleQueueItems: QueueListItem[];
  iconViewItems: QueueListItem[];
  queueModeProcessingJobs: TranscodeJob[];
  queueModeWaitingItems: QueueListItem[];
  queueModeWaitingBatchIds: Set<string>;
  /** UI-only: jobs that have requested pause but are still processing. */
  pausingJobIds: Set<string>;
  presets: FFmpegPreset[];

  // View settings
  queueViewMode: QueueViewMode;
  /** Resolved ffmpeg executable path from backend/tool status (if known). */
  ffmpegResolvedPath?: string | null;
  queueProgressStyle: QueueProgressStyle;
  queueMode: QueueMode;
  isIconViewMode: boolean;
  isCarousel3dViewMode: boolean;
  carouselAutoRotationSpeed: number;
  iconViewSize: "small" | "medium" | "large";
  iconGridClass: string;
  queueRowVariant: "detail" | "compact";
  progressUpdateIntervalMs: number;
  hasBatchCompressBatches: boolean;

  // Filter/sort state
  activeStatusFilters: Set<QueueFilterStatus>;
  activeTypeFilters: Set<QueueFilterKind>;
  filterText: string;
  filterUseRegex: boolean;
  filterRegexError: string | null;
  sortPrimary: QueueSortField;
  sortPrimaryDirection: QueueSortDirection;
  hasSelection: boolean;
  hasActiveFilters: boolean;
  /** IDs of currently selected jobs for visual checkboxes. */
  selectedJobIds: Set<string>;
  selectedCount: number;

  // Batch expansion
  expandedBatchIds: Set<string>;

  /** 排序比较函数，用于对批次子任务进行排序 */
  sortCompareFn?: (a: TranscodeJob, b: TranscodeJob) => number;
}

export type QueuePanelEmits = {
  "update:queueViewMode": [value: QueueViewMode];
  "update:queueProgressStyle": [value: QueueProgressStyle];
  "update:queueMode": [value: QueueMode];
  "update:filterText": [value: string];
  "update:sortPrimary": [value: QueueSortField];
  "update:sortPrimaryDirection": [value: QueueSortDirection];
  addJobFiles: [];
  addJobFolder: [];
  toggleStatusFilter: [status: QueueFilterStatus];
  toggleTypeFilter: [kind: QueueFilterKind];
  toggleFilterRegexMode: [];
  resetQueueFilters: [];
  selectAllVisibleJobs: [];
  invertSelection: [];
  clearSelection: [];
  bulkCancel: [];
  bulkWait: [];
  bulkResume: [];
  bulkRestart: [];
  bulkMoveToTop: [];
  bulkMoveToBottom: [];
  bulkDelete: [];
  cancelJob: [jobId: string];
  waitJob: [jobId: string];
  resumeJob: [jobId: string];
  restartJob: [jobId: string];
  toggleJobSelected: [jobId: string];
  inspectJob: [job: TranscodeJob];
  previewJob: [job: TranscodeJob];
  compareJob: [job: TranscodeJob];
  toggleBatchExpanded: [batchId: string];
  openBatchDetail: [batch: CompositeBatchCompressTask];
  isJobSelected: [jobId: string];
  openJobContextMenu: [payload: { job: TranscodeJob; event: MouseEvent }];
  openBulkContextMenu: [event: MouseEvent];
};
