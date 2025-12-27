import { computed, ref, type ComputedRef, type Ref } from "vue";
import type {
  CompositeBatchCompressTask,
  FFmpegPreset,
  QueueBulkActionKind,
  QueueMode,
  QueueProgressStyle,
  QueueViewMode,
  TranscodeJob,
  Translate,
} from "@/types";
import type { QueueOperationMethods } from "../queue/queueOperations.types";
import { useQueuePreferences } from "@/lib/queuePreferences";
import { type QueueListItem, useQueueFiltering, useQueueOperations, type UseQueueFilteringReturn } from "@/composables";
import { useQueueEventListeners } from "./useMainAppQueue.events";
import { createQueueBulkActionsWithFeedback } from "./useMainAppQueue.bulkActions";
import {
  ensureManualPresetId,
  getQueueIconGridClass,
  ICON_VIEW_MAX_VISIBLE_ITEMS,
  resolveManualPreset,
} from "./useMainAppQueue.ui";
import { compareJobsInWaitingGroup, isTerminalStatus, isWaitingStatus } from "./useMainAppQueue.waiting";
import { buildFilteredJobsForTests } from "./useMainAppQueue.filteredJobsForTests";
import { guardExclusiveAsyncAction } from "./useMainAppQueue.guards";
import { usePausingJobIds } from "./useMainAppQueue.pausing";

export { getQueueIconGridClass } from "./useMainAppQueue.ui";

export interface UseMainAppQueueOptions {
  t: Translate;
  jobs: Ref<TranscodeJob[]>;
  queueError: Ref<string | null>;
  lastQueueSnapshotAtMs: Ref<number | null>;
  lastQueueSnapshotRevision: Ref<number | null>;
  presets: Ref<FFmpegPreset[]>;
  manualJobPresetId: Ref<string | null>;
  compositeBatchCompressTasks: ComputedRef<CompositeBatchCompressTask[]>;
  compositeTasksById: ComputedRef<Map<string, CompositeBatchCompressTask>>;
  onJobCompleted?: (job: TranscodeJob) => void;
  /** Optional startup idle gate so the initial queue poll can be deferred. */
  startupIdleReady?: Ref<boolean>;
}

export interface UseMainAppQueueReturn
  extends
    QueueOperationMethods,
    Pick<
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
  carouselAutoRotationSpeed: Ref<number>;
  setQueueViewMode: (mode: QueueViewMode) => void;
  setQueueProgressStyle: (style: QueueProgressStyle) => void;
  setQueueMode: (mode: QueueMode) => void;
  setCarouselAutoRotationSpeed: (speed: number) => void;
  queueViewModeModel: Ref<QueueViewMode>;
  queueModeModel: Ref<QueueMode>;
  queueProgressStyleModel: Ref<QueueProgressStyle>;
  queueRowVariant: ComputedRef<"detail" | "compact" | "mini">;
  isIconViewMode: ComputedRef<boolean>;
  isCarousel3dViewMode: ComputedRef<boolean>;
  iconViewSize: ComputedRef<"small" | "medium" | "large">;
  iconGridClass: ComputedRef<string>;

  queueJobsForDisplay: ComputedRef<TranscodeJob[]>;
  visibleQueueItems: ComputedRef<QueueListItem[]>;
  iconViewItems: ComputedRef<QueueListItem[]>;
  hasPrimarySortTies: ComputedRef<boolean>;

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
  /** UI-only: which bulk action is currently running (for button feedback). */
  bulkActionInProgress: Ref<QueueBulkActionKind | null>;
  /** Queue-mode waiting items (manual jobs + Batch Compress batches interleaved). */
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
    lastQueueSnapshotRevision,
    presets,
    manualJobPresetId,
    compositeBatchCompressTasks,
    compositeTasksById,
    onJobCompleted,
    startupIdleReady,
  } = options;

  // Queue view preferences
  const {
    queueViewMode,
    queueProgressStyle,
    queueMode,
    carouselAutoRotationSpeed,
    setQueueViewMode,
    setQueueProgressStyle,
    setQueueMode,
    setCarouselAutoRotationSpeed,
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

  const queueRowVariant = computed<"detail" | "compact" | "mini">(() => {
    if (queueViewMode.value === "mini") return "mini";
    if (queueViewMode.value === "compact") return "compact";
    return "detail";
  });

  const isIconViewMode = computed(
    () =>
      queueViewMode.value === "icon-small" ||
      queueViewMode.value === "icon-medium" ||
      queueViewMode.value === "icon-large",
  );

  const isCarousel3dViewMode = computed(() => queueViewMode.value === "carousel-3d");

  const iconViewSize = computed<"small" | "medium" | "large">(() => {
    if (queueViewMode.value === "icon-large") return "large";
    if (queueViewMode.value === "icon-medium") return "medium";
    return "small";
  });

  const iconGridClass = computed(() => {
    return getQueueIconGridClass(queueViewMode.value);
  });

  const manualJobPreset = computed<FFmpegPreset | null>(() =>
    resolveManualPreset(presets.value, manualJobPresetId.value),
  );

  ensureManualPresetId(presets.value, manualJobPresetId);

  const pausingJobIds = usePausingJobIds(jobs);

  // Monotonic progress revision used to trigger progress-based sorting without
  // reintroducing full-list ordering fingerprints on every delta tick.
  const queueProgressRevision = ref(0);
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
    queueStructureRevision: lastQueueSnapshotRevision,
    queueProgressRevision,
    compositeBatchCompressTasks,
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
    applyQueueStateLiteDeltaFromBackend,
    handleWaitJob,
    handleResumeJob,
    handleRestartJob,
    handleCancelJob,
    enqueueManualJobsFromPaths,
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
    manualJobPreset,
    presets,
    queueError,
    selectedJobIds,
    selectedJobs,
    lastQueueSnapshotAtMs,
    lastQueueSnapshotRevision,
    queueProgressRevision,
    t: (key: string, params?: Record<string, unknown>) => t(key, params),
    onJobCompleted,
  });

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
      // Queue mode: always include processing items for icon/carousel views.
      for (const job of queueModeProcessingJobs.value) {
        items.push({ kind: "job", job });
      }
      const waitingItems = queueModeWaitingItems.value;
      const waitingBatchIds = queueModeWaitingBatchIds.value;
      items.push(...waitingItems);

      for (const batch of compositeBatchCompressTasks.value) {
        if (waitingBatchIds.has(batch.batchId)) continue;
        if (batchMatchesFilters(batch)) items.push({ kind: "batch", batch });
      }

      for (const job of displayModeSortedJobs.value) {
        if (job.batchId) continue;
        if (isTerminalStatus(job.status)) items.push({ kind: "job", job });
      }

      return items;
    }

    for (const batch of compositeBatchCompressTasks.value) {
      if (batchMatchesFilters(batch)) items.push({ kind: "batch", batch });
    }
    for (const job of displayModeSortedJobs.value) {
      if (!job.batchId) items.push({ kind: "job", job });
    }
    return items;
  });

  const iconViewItems = computed<QueueListItem[]>(() => visibleQueueItems.value.slice(0, ICON_VIEW_MAX_VISIBLE_ITEMS));

  const queueJobsForDisplay = computed<TranscodeJob[]>(() =>
    queueMode.value === "queue" ? manualQueueJobs.value : displayModeSortedJobs.value,
  );

  // Expose filtered list for tests and legacy consumers.
  const filteredJobsForTests = buildFilteredJobsForTests({
    queueMode,
    manualQueueJobs,
    displayModeSortedJobs,
    queueModeProcessingJobs,
    queueModeWaitingJobs,
  });

  const {
    bulkWait,
    bulkResume,
    bulkRestart,
    bulkMoveToTop,
    bulkMoveToBottom,
    bulkDelete,
    bulkMoveSelectedJobsToTop,
    bulkMoveSelectedJobsToBottom,
    moveJobToTop,
    bulkCancelWithFeedback,
  } = createQueueBulkActionsWithFeedback({
    t,
    jobs,
    selectedJobs,
    selectedJobIds,
    queueError,
    lastQueueSnapshotRevision,
    refreshQueueFromBackend,
    bulkWaitSelectedJobs,
    bulkResumeSelectedJobs,
    bulkRestartSelectedJobs,
    bulkCancelSelectedJobs,
    bulkMoveSelectedJobsToTopInner,
    bulkMoveSelectedJobsToBottomInner,
  });

  const bulkActionInProgress = ref<QueueBulkActionKind | null>(null);

  const bulkWaitWithFeedback = guardExclusiveAsyncAction(bulkActionInProgress, "wait", bulkWait);
  const bulkResumeWithFeedback = guardExclusiveAsyncAction(bulkActionInProgress, "resume", bulkResume);
  const bulkRestartWithFeedback = guardExclusiveAsyncAction(bulkActionInProgress, "restart", bulkRestart);
  const bulkMoveToTopWithFeedback = guardExclusiveAsyncAction(bulkActionInProgress, "moveToTop", bulkMoveToTop);
  const bulkMoveToBottomWithFeedback = guardExclusiveAsyncAction(
    bulkActionInProgress,
    "moveToBottom",
    bulkMoveToBottom,
  );
  const bulkDeleteWithFeedback = guardExclusiveAsyncAction(bulkActionInProgress, "delete", bulkDelete);
  const bulkCancelWithFeedbackGuarded = guardExclusiveAsyncAction(
    bulkActionInProgress,
    "cancel",
    bulkCancelWithFeedback,
  );

  // Queue / Batch Compress event listeners for queue state updates.
  useQueueEventListeners({
    jobs,
    lastQueueSnapshotAtMs,
    lastQueueSnapshotRevision,
    startupIdleReady,
    refreshQueueFromBackend,
    applyQueueStateFromBackend,
    applyQueueStateLiteDeltaFromBackend,
  });

  return {
    queueViewMode,
    queueProgressStyle,
    queueMode,
    carouselAutoRotationSpeed,
    setQueueViewMode,
    setQueueProgressStyle,
    setQueueMode,
    setCarouselAutoRotationSpeed,
    queueViewModeModel,
    queueModeModel,
    queueProgressStyleModel,
    queueRowVariant,
    isIconViewMode,
    isCarousel3dViewMode,
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
    enqueueManualJobsFromPaths,
    enqueueManualJobFromPath,

    bulkCancel: bulkCancelWithFeedbackGuarded,
    bulkWait: bulkWaitWithFeedback,
    bulkResume: bulkResumeWithFeedback,
    bulkRestart: bulkRestartWithFeedback,
    bulkMoveToTop: bulkMoveToTopWithFeedback,
    bulkMoveToBottom: bulkMoveToBottomWithFeedback,
    bulkMoveSelectedJobsToTop,
    bulkMoveSelectedJobsToBottom,
    bulkMoveSelectedJobsToTopInner,
    bulkMoveSelectedJobsToBottomInner,
    moveJobToTop,
    bulkDelete: bulkDeleteWithFeedback,
    bulkActionInProgress,
    pausingJobIds,
  };
}
