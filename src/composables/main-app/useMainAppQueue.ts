import { computed, onMounted, onUnmounted, type ComputedRef, type Ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { hasTauri } from "@/lib/backend";
import type {
  CompositeSmartScanTask,
  FFmpegPreset,
  QueueMode,
  QueueProgressStyle,
  QueueState,
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
import { buildWaitingQueueIds, reorderWaitingQueue } from "@/composables/queue/operations-bulk";

export interface UseMainAppQueueOptions {
  t: (key: string) => string;
  jobs: Ref<TranscodeJob[]>;
  queueError: Ref<string | null>;
  lastQueueSnapshotAtMs: Ref<number | null>;
  presets: Ref<FFmpegPreset[]>;
  manualJobPresetId: Ref<string | null>;
  compositeSmartScanTasks: ComputedRef<CompositeSmartScanTask[]>;
  compositeTasksById: ComputedRef<Map<string, CompositeSmartScanTask>>;
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
  bulkDelete: () => void;
}

const ICON_VIEW_MAX_VISIBLE_ITEMS = 200;

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
    if (queueViewMode.value === "icon-large") {
      return "grid gap-3 grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3";
    }
    if (queueViewMode.value === "icon-medium") {
      return "grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4";
    }
    return "grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5";
  });

  const manualJobPreset = computed<FFmpegPreset | null>(() => {
    const list = presets.value;
    if (!list || list.length === 0) return null;
    const id = manualJobPresetId.value;
    if (!id) return list[0];
    return list.find((p) => p.id === id) ?? list[0];
  });

  const ensureManualPresetId = () => {
    const list = presets.value;
    if (!list || list.length === 0) {
      manualJobPresetId.value = null;
      return;
    }
    if (!manualJobPresetId.value || !list.some((p) => p.id === manualJobPresetId.value)) {
      manualJobPresetId.value = list[0].id;
    }
  };

  ensureManualPresetId();

  const smartScanJobs = computed<TranscodeJob[]>(() =>
    jobs.value.filter((job) => job.source === "smart_scan"),
  );

  const {
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
    hideJobsById,
    compareJobsByConfiguredFields,
    compareJobsForDisplay,
  } = useQueueFiltering({
    jobs,
    compositeSmartScanTasks,
    compositeTasksById,
    t: (key: string) => t(key),
  });

  // Keep additional filtering internals visible for tests.
  void hiddenJobIds;
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
    smartScanJobs,
    manualJobPreset,
    presets,
    queueError,
    selectedJobIds,
    selectedJobs,
    lastQueueSnapshotAtMs,
    t: (key: string) => t(key),
  });

  void addManualJobMock;

  const visibleQueueItems = computed<QueueListItem[]>(() => {
    const items: QueueListItem[] = [];
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

  const bulkCancel = async () => {
    await bulkCancelSelectedJobs();
  };

  const bulkWait = async () => {
    await bulkWaitSelectedJobs();
  };

  const bulkResume = async () => {
    await bulkResumeSelectedJobs();
  };

  const bulkRestart = async () => {
    await bulkRestartSelectedJobs();
  };

  const bulkMoveToTop = async () => {
    await bulkMoveSelectedJobsToTopInner();
  };

  const bulkMoveToBottom = async () => {
    await bulkMoveSelectedJobsToBottomInner();
  };

  const moveJobToTop = async (jobId: string) => {
    if (!jobId) return;
    const waitingIds = buildWaitingQueueIds({ jobs });
    if (!waitingIds.includes(jobId)) return;
    const remaining = waitingIds.filter((id) => id !== jobId);
    await reorderWaitingQueue([jobId, ...remaining], {
      jobs,
      selectedJobIds,
      selectedJobs,
      queueError,
      t: (key: string) => t(key),
      refreshQueueFromBackend,
      handleCancelJob,
      handleWaitJob,
      handleResumeJob,
      handleRestartJob,
    });
  };

  // Public helpers used directly in tests.
  const bulkMoveSelectedJobsToTop = async () => {
    await bulkMoveSelectedJobsToTopInner();
  };

  const bulkMoveSelectedJobsToBottom = async () => {
    await bulkMoveSelectedJobsToBottomInner();
  };

  const bulkDelete = () => {
    hideJobsById(Array.from(selectedJobIds.value));
  };

  // Queue / Smart Scan event listeners for queue state updates.
  let queueUnlisten: UnlistenFn | null = null;
  let queueTimer: number | undefined;

  onMounted(() => {
    if (!hasTauri()) {
      return;
    }

    void listen<QueueState>("ffui://queue-state", (event) => {
      jobs.value = event.payload.jobs;
      lastQueueSnapshotAtMs.value = Date.now();
    })
      .then((unlisten) => {
        queueUnlisten = unlisten;
      })
      .catch((err) => {
        console.error("Failed to register queue_state listener:", err);
      });

    void refreshQueueFromBackend();

    if (queueTimer !== undefined) {
      clearInterval(queueTimer);
    }

    queueTimer = window.setInterval(() => {
      const snapshot = jobs.value;
      if (!snapshot || snapshot.length === 0) return;

      const hasStuckProcessingJob = snapshot.some(
        (job) => job.status === "processing" && (!job.progress || job.progress <= 0),
      );
      if (!hasStuckProcessingJob) return;

      const lastSnapshotAt = lastQueueSnapshotAtMs.value;
      const ageMs =
        typeof lastSnapshotAt === "number"
          ? Date.now() - lastSnapshotAt
          : Number.POSITIVE_INFINITY;

      if (ageMs > 5000) {
        void refreshQueueFromBackend();
      }
    }, 3000);
  });

  onUnmounted(() => {
    if (queueUnlisten) {
      try {
        queueUnlisten();
      } catch (err) {
        console.error("Failed to unlisten queue_state event:", err);
      } finally {
        queueUnlisten = null;
      }
    }

    if (queueTimer !== undefined) {
      clearInterval(queueTimer);
      queueTimer = undefined;
    }
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
  };
}

export default useMainAppQueue;
