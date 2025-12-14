import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type {
  CompositeSmartScanTask,
  FFmpegPreset,
  QueueMode,
  QueueProgressStyle,
  QueueViewMode,
  TranscodeJob,
} from "@/types";
import { useQueuePreferences } from "@/lib/queuePreferences";
import {
  type QueueListItem,
  useQueueFiltering,
  useQueueOperations,
  type UseQueueFilteringReturn,
} from "@/composables";
import { useQueueEventListeners } from "./useMainAppQueue.events";
import { createBulkDelete } from "./useMainAppQueue.bulkDelete";
import {
  ensureManualPresetId,
  getQueueIconGridClass,
  ICON_VIEW_MAX_VISIBLE_ITEMS,
} from "./useMainAppQueue.ui";
import {
  compareJobsInWaitingGroup,
  isTerminalStatus,
  isWaitingStatus,
} from "./useMainAppQueue.waiting";

export { getQueueIconGridClass } from "./useMainAppQueue.ui";

export interface UseMainAppQueueOptions {
  t: (key: string) => string;
  jobs: Ref<TranscodeJob[]>;
  queueError: Ref<string | null>;
  lastQueueSnapshotAtMs: Ref<number | null>;
  presets: Ref<FFmpegPreset[]>;
  manualJobPresetId: Ref<string | null>;
  compositeSmartScanTasks: ComputedRef<CompositeSmartScanTask[]>;
  compositeTasksById: ComputedRef<Map<string, CompositeSmartScanTask>>;
  onJobCompleted?: (job: TranscodeJob) => void;
  /** Optional startup idle gate so the initial queue poll can be deferred. */
  startupIdleReady?: Ref<boolean>;
}

export interface UseMainAppQueueReturn
  extends Pick<
    UseQueueFilteringReturn,
    | "selectedJobIds"
    | "activeStatusFilters"
    | "activeTypeFilters"
    | "filterText"
    | "filterUseRegex"
    | "filterRegexError"
    | "sortPrimary"
    | "sortPrimaryDirection"
    | "sortSecondary"
    | "sortSecondaryDirection"
    | "filteredJobs"
    | "hasActiveFilters"
    | "hasSelection"
    | "queueModeProcessingJobs"
    | "queueModeWaitingJobs"
    | "selectAllVisibleJobs"
    | "invertSelection"
    | "clearSelection"
    | "toggleStatusFilter"
    | "toggleTypeFilter"
    | "resetQueueFilters"
    | "toggleFilterRegexMode"
    | "toggleJobSelected"
    | "compareJobsForDisplay"
  > {
  queueViewMode: Ref<QueueViewMode>;
  queueProgressStyle: Ref<QueueProgressStyle>;
  queueMode: Ref<QueueMode>;
  setQueueViewMode: (mode: QueueViewMode) => void;
  setQueueProgressStyle: (style: QueueProgressStyle) => void;
  setQueueMode: (mode: QueueMode) => void;
  queueViewModeModel: Ref<QueueViewMode>;
  queueModeModel: Ref<QueueMode>;
  queueProgressStyleModel: Ref<QueueProgressStyle>;
  queueRowVariant: ComputedRef<"detail" | "compact">;
  isIconViewMode: ComputedRef<boolean>;
  iconViewSize: ComputedRef<"small" | "medium" | "large">;
  iconGridClass: ComputedRef<string>;

  queueJobsForDisplay: ComputedRef<TranscodeJob[]>;
  visibleQueueItems: ComputedRef<QueueListItem[]>;
  iconViewItems: ComputedRef<QueueListItem[]>;
  hasPrimarySortTies: ComputedRef<boolean>;

  refreshQueueFromBackend: () => Promise<void>;
  handleWaitJob: (jobId: string) => Promise<void>;
  handleResumeJob: (jobId: string) => Promise<void>;
  handleRestartJob: (jobId: string) => Promise<void>;
  handleCancelJob: (jobId: string) => Promise<void>;
  addManualJobMock: () => void;
  enqueueManualJobFromPath: (path: string) => Promise<void>;

  bulkCancel: () => Promise<void>;
  bulkWait: () => Promise<void>;
  bulkResume: () => Promise<void>;
  bulkRestart: () => Promise<void>;
  bulkMoveToTop: () => Promise<void>;
  bulkMoveToBottom: () => Promise<void>;
  bulkMoveSelectedJobsToTop: () => Promise<void>;
  bulkMoveSelectedJobsToBottom: () => Promise<void>;
  bulkMoveSelectedJobsToTopInner: () => Promise<void>;
  bulkMoveSelectedJobsToBottomInner: () => Promise<void>;
  moveJobToTop: (jobId: string) => Promise<void>;
  bulkDelete: () => Promise<void>;
  /** Queue-mode waiting items (manual jobs + Smart Scan batches interleaved). */
  queueModeWaitingItems: ComputedRef<QueueListItem[]>;
  /** Batch ids already rendered in queueModeWaitingItems (for de-dupe). */
  queueModeWaitingBatchIds: ComputedRef<Set<string>>;
  /** UI-only: jobs with a pending "wait" request while still processing. */
  pausingJobIds: Ref<Set<string>>;
}

/**
 * Queue state, filtering, and operations wiring for MainApp.
 */
export function useMainAppQueue(options: UseMainAppQueueOptions): UseMainAppQueueReturn {
  const {
    t,
    jobs,
    queueError,
    lastQueueSnapshotAtMs,
    presets,
    manualJobPresetId,
    compositeSmartScanTasks,
    compositeTasksById,
    onJobCompleted,
    startupIdleReady,
  } = options;

  // Queue view preferences
  const {
    queueViewMode,
    queueProgressStyle,
    queueMode,
    setQueueViewMode,
    setQueueProgressStyle,
    setQueueMode,
  } = useQueuePreferences();

  const queueViewModeModel = computed<QueueViewMode>({
    get: () => queueViewMode.value,
    set: (value) => setQueueViewMode(value),
  });

  const queueModeModel = computed<QueueMode>({
    get: () => queueMode.value,
    set: (value) => setQueueMode(value),
  });

  const queueProgressStyleModel = computed<QueueProgressStyle>({
    get: () => queueProgressStyle.value,
    set: (value) => setQueueProgressStyle(value),
  });

  const queueRowVariant = computed<"detail" | "compact">(() => {
    return queueViewMode.value === "compact" ? "compact" : "detail";
  });

  const isIconViewMode = computed(
    () =>
      queueViewMode.value === "icon-small" ||
      queueViewMode.value === "icon-medium" ||
      queueViewMode.value === "icon-large",
  );

  const iconViewSize = computed<"small" | "medium" | "large">(() => {
    if (queueViewMode.value === "icon-large") return "large";
    if (queueViewMode.value === "icon-medium") return "medium";
    return "small";
  });

  const iconGridClass = computed(() => {
    return getQueueIconGridClass(queueViewMode.value);
  });

  const manualJobPreset = computed<FFmpegPreset | null>(() => {
    const list = presets.value;
    if (!list || list.length === 0) return null;
    const id = manualJobPresetId.value;
    if (!id) return list[0];
    return list.find((p) => p.id === id) ?? list[0];
  });

  ensureManualPresetId(presets.value, manualJobPresetId);
  const smartScanJobs = computed<TranscodeJob[]>(() =>
    jobs.value.filter((job) => job.source === "smart_scan"),
  );

  // UI-only: track jobs that have requested "wait/pause" but remain in
  // processing state until the backend reaches a safe point and marks them paused.
  const pausingJobIds = ref<Set<string>>(new Set());
  watch(
    jobs,
    (nextJobs) => {
      if (pausingJobIds.value.size === 0) return;
      const byId = new Map(nextJobs.map((job) => [job.id, job]));
      const next = new Set<string>();
      for (const id of pausingJobIds.value) {
        const job = byId.get(id);
        if (job && job.status === "processing") {
          next.add(id);
        }
      }
      if (next.size !== pausingJobIds.value.size) {
        pausingJobIds.value = next;
      }
    },
    { deep: false },
  );
  const {
    selectedJobIds,
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
    hasActiveFilters,
    hasSelection,
    hasPrimarySortTies,
    selectedJobs,
    filteredJobs,
    displayModeSortedJobs,
    manualQueueJobs,
    queueModeProcessingJobs,
    queueModeWaitingJobs,
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
    compareJobsByConfiguredFields,
    compareJobsForDisplay,
  } = useQueueFiltering({
    jobs,
    compositeSmartScanTasks,
    compositeTasksById,
    t: (key: string) => t(key),
  });

  // Keep additional filtering internals visible for tests.
  void filterRegex;
  void sortSecondary;
  void sortSecondaryDirection;
  void filteredJobs;
  void jobMatchesFilters;
  void isJobSelected;
  void compareJobsByConfiguredFields;
  void compareJobsForDisplay;
  void hasPrimarySortTies;

  const {
    refreshQueueFromBackend,
    applyQueueStateFromBackend,
    handleWaitJob,
    handleResumeJob,
    handleRestartJob,
    handleCancelJob,
    addManualJobMock,
    enqueueManualJobFromPath,
    bulkCancelSelectedJobs,
    bulkWaitSelectedJobs,
    bulkResumeSelectedJobs,
    bulkRestartSelectedJobs,
    bulkMoveSelectedJobsToTop: bulkMoveSelectedJobsToTopInner,
    bulkMoveSelectedJobsToBottom: bulkMoveSelectedJobsToBottomInner,
  } = useQueueOperations({
    jobs,
    pausingJobIds,
    smartScanJobs,
    manualJobPreset,
    presets,
    queueError,
    selectedJobIds,
    selectedJobs,
    lastQueueSnapshotAtMs,
    t: (key: string) => t(key),
    onJobCompleted,
  });
  void addManualJobMock;

  const queueModeWaitingItems = computed<QueueListItem[]>(() => {
    if (queueMode.value !== "queue") return [];

    const waitingJobs = filteredJobs.value
      .filter((job) => isWaitingStatus(job.status))
      .slice()
      .sort((a, b) => compareJobsInWaitingGroup(a, b, compareJobsByConfiguredFields));

    const items: QueueListItem[] = [];
    const renderedBatchIds = new Set<string>();

    for (const job of waitingJobs) {
      const batchId = job.batchId;
      if (batchId) {
        if (renderedBatchIds.has(batchId)) continue;
        const batch = compositeTasksById.value.get(batchId);
        if (batch && batchMatchesFilters(batch)) {
          items.push({ kind: "batch", batch });
          renderedBatchIds.add(batchId);
        }
        continue;
      }
      items.push({ kind: "job", job });
    }

    return items;
  });

  const queueModeWaitingBatchIds = computed<Set<string>>(() => {
    const ids = new Set<string>();
    for (const item of queueModeWaitingItems.value) {
      if (item.kind === "batch") ids.add(item.batch.batchId);
    }
    return ids;
  });

  const visibleQueueItems = computed<QueueListItem[]>(() => {
    const items: QueueListItem[] = [];

    if (queueMode.value === "queue") {
      const waitingItems = queueModeWaitingItems.value;
      const waitingBatchIds = queueModeWaitingBatchIds.value;
      items.push(...waitingItems);

      for (const batch of compositeSmartScanTasks.value) {
        if (waitingBatchIds.has(batch.batchId)) continue;
        if (batchMatchesFilters(batch)) items.push({ kind: "batch", batch });
      }

      for (const job of displayModeSortedJobs.value) {
        if (job.batchId) continue;
        if (isTerminalStatus(job.status)) items.push({ kind: "job", job });
      }

      return items;
    }

    for (const batch of compositeSmartScanTasks.value) {
      if (batchMatchesFilters(batch)) items.push({ kind: "batch", batch });
    }
    for (const job of displayModeSortedJobs.value) {
      if (!job.batchId) items.push({ kind: "job", job });
    }
    return items;
  });

  const iconViewItems = computed<QueueListItem[]>(() =>
    visibleQueueItems.value.slice(0, ICON_VIEW_MAX_VISIBLE_ITEMS),
  );

  const queueJobsForDisplay = computed<TranscodeJob[]>(() =>
    queueMode.value === "queue" ? manualQueueJobs.value : displayModeSortedJobs.value,
  );

  // Expose filtered list for tests and legacy consumers.
  const filteredJobsForTests = computed(() => {
    if (queueMode.value === "queue") {
      const processing = queueModeProcessingJobs.value;
      const waiting = queueModeWaitingJobs.value;
      const waitingIds = new Set(waiting.map((j) => j.id));
      const processingIds = new Set(processing.map((j) => j.id));
      const others = manualQueueJobs.value.filter(
        (job) => !waitingIds.has(job.id) && !processingIds.has(job.id),
      );
      return [...processing, ...waiting, ...others];
    }
    return displayModeSortedJobs.value;
  });

  const bulkCancel = async () => bulkCancelSelectedJobs();
  const bulkWait = async () => bulkWaitSelectedJobs();
  const bulkResume = async () => bulkResumeSelectedJobs();
  const bulkRestart = async () => bulkRestartSelectedJobs();
  const bulkMoveToTop = async () => bulkMoveSelectedJobsToTopInner();
  const bulkMoveToBottom = async () => bulkMoveSelectedJobsToBottomInner();

  const moveJobToTop = async (jobId: string) => {
    if (!jobId) return;
    selectedJobIds.value = new Set([jobId]);
    await bulkMoveSelectedJobsToTopInner();
  };

  // Public helpers used directly in tests.
  const bulkMoveSelectedJobsToTop = async () => bulkMoveSelectedJobsToTopInner();
  const bulkMoveSelectedJobsToBottom = async () => bulkMoveSelectedJobsToBottomInner();

  const bulkDelete = createBulkDelete({
    jobs,
    selectedJobIds,
    selectedJobs,
    queueError,
    refreshQueueFromBackend,
    t: (key: string) => t(key),
  });

  // Queue / Smart Scan event listeners for queue state updates.
  useQueueEventListeners({
    jobs,
    lastQueueSnapshotAtMs,
    startupIdleReady,
    refreshQueueFromBackend,
    applyQueueStateFromBackend,
  });

  return {
    queueViewMode,
    queueProgressStyle,
    queueMode,
    setQueueViewMode,
    setQueueProgressStyle,
    setQueueMode,
    queueViewModeModel,
    queueModeModel,
    queueProgressStyleModel,
    queueRowVariant,
    isIconViewMode,
    iconViewSize,
    iconGridClass,

    selectedJobIds,
    activeStatusFilters,
    activeTypeFilters,
    filterText,
    filterUseRegex,
    filterRegexError,
    sortPrimary,
    sortPrimaryDirection,
    sortSecondary,
    sortSecondaryDirection,
    hasActiveFilters,
    hasSelection,
    hasPrimarySortTies,
    queueModeProcessingJobs,
    queueModeWaitingJobs,
    selectAllVisibleJobs,
    invertSelection,
    clearSelection,
    toggleStatusFilter,
    toggleTypeFilter,
    resetQueueFilters,
    toggleFilterRegexMode,
    toggleJobSelected,

    queueJobsForDisplay,
    filteredJobs: filteredJobsForTests,
    visibleQueueItems,
    iconViewItems,
    compareJobsForDisplay,
    queueModeWaitingItems,
    queueModeWaitingBatchIds,

    refreshQueueFromBackend,
    handleWaitJob,
    handleResumeJob,
    handleRestartJob,
    handleCancelJob,
    addManualJobMock,
    enqueueManualJobFromPath,

    bulkCancel,
    bulkWait,
    bulkResume,
    bulkRestart,
    bulkMoveToTop,
    bulkMoveToBottom,
    bulkMoveSelectedJobsToTop,
    bulkMoveSelectedJobsToBottom,
    bulkMoveSelectedJobsToTopInner,
    bulkMoveSelectedJobsToBottomInner,
    moveJobToTop,
    bulkDelete,
    pausingJobIds,
  };
}
