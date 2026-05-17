import { computed } from "vue";
import type { AppSettings } from "@/types";
import type {
  DialogsDomain,
  MediaDomain,
  PresetsDomain,
  QueueDomain,
  SettingsDomain,
  ShellDomain,
} from "@/MainApp.types";
import { useMainAppQueue } from "@/composables/main-app/useMainAppQueue";
import { useMainAppDnDAndContextMenu } from "@/composables/main-app/useMainAppDnDAndContextMenu";
import { useQueueContextMenu } from "@/composables/main-app/useQueueContextMenu";
import { useQueueOutputPolicy } from "@/composables/main-app/useQueueOutputPolicy";
import { createQueuePanelProps } from "@/composables/main-app/queuePanelBindings";
import { useBatchCompressQueueRefresh } from "@/composables/main-app/useBatchCompressQueueRefresh";
import { useQueueStartupToast } from "@/composables/main-app/useQueueStartupToast";
import type { useMainAppBatchCompress } from "@/composables/main-app/useMainAppBatchCompress";
import type { MainAppSharedState } from "./useMainAppSharedState";

export interface UseMainAppQueueDomainOptions {
  state: MainAppSharedState;
  shell: ShellDomain;
  dialogs: Pick<DialogsDomain, "dialogManager">;
  media: MediaDomain;
  presets: PresetsDomain;
  settings: SettingsDomain;
  batchCompress: ReturnType<typeof useMainAppBatchCompress>;
}

const createTemporaryAppSettings = (): AppSettings =>
  ({
    tools: {},
    batchCompressDefaults: {},
    previewCapturePercent: 50,
  }) as AppSettings;

export function useMainAppQueueDomain(options: UseMainAppQueueDomainOptions): QueueDomain {
  const { state, shell, dialogs, media, presets, settings, batchCompress } = options;
  const queue = useMainAppQueue({
    t: state.t,
    jobs: state.jobs,
    queueError: state.queueError,
    lastQueueSnapshotAtMs: state.lastQueueSnapshotAtMs,
    lastQueueSnapshotRevision: state.lastQueueSnapshotRevision,
    presets: state.presets,
    manualJobPresetId: state.manualJobPresetId,
    compositeBatchCompressTasks: batchCompress.compositeBatchCompressTasks,
    compositeTasksById: batchCompress.compositeTasksById,
    onJobCompleted: presets.handleCompletedJobFromBackend,
    startupIdleReady: state.startupIdleReady,
  });

  useQueueStartupToast({
    enabled: !state.isTestEnv,
    t: state.t,
    jobs: state.jobs,
    lastQueueSnapshotRevision: state.lastQueueSnapshotRevision,
    refreshQueueFromBackend: queue.refreshQueueFromBackend,
  });

  useBatchCompressQueueRefresh({
    batchCompressBatchMeta: batchCompress.batchCompressBatchMeta,
    jobs: state.jobs,
    refreshQueueFromBackend: queue.refreshQueueFromBackend,
  });

  const dnd = useMainAppDnDAndContextMenu({
    activeTab: shell.activeTab,
    inspectMediaForPath: media.inspectMediaForPath,
    enqueueManualJobsFromPaths: queue.enqueueManualJobsFromPaths,
    selectedJobIds: queue.selectedJobIds,
    bulkMoveSelectedJobsToTopInner: queue.bulkMoveSelectedJobsToTopInner,
  });

  const selectionBarPinned = computed(() => settings.appSettings.value?.selectionBarPinned ?? false);
  const setSelectionBarPinned = (pinned: boolean) => {
    const current = settings.appSettings.value;
    if (current?.selectionBarPinned === pinned) return;

    settings.appSettings.value = {
      ...(current ?? createTemporaryAppSettings()),
      selectionBarPinned: pinned,
    };
  };

  const { queueOutputPolicy, setQueueOutputPolicy } = useQueueOutputPolicy(settings.appSettings);
  const queueTotalCount = computed(() => state.jobs.value.length);
  const queuePanelProps = createQueuePanelProps({
    queueJobsForDisplay: queue.queueJobsForDisplay,
    visibleQueueItems: queue.visibleQueueItems,
    iconViewItems: queue.iconViewItems,
    queueModeProcessingJobs: queue.queueModeProcessingJobs,
    queueModeWaitingItems: queue.queueModeWaitingItems,
    queueModeWaitingBatchIds: queue.queueModeWaitingBatchIds,
    presets: state.presets,
    queueViewMode: queue.queueViewMode,
    ffmpegResolvedPath: settings.ffmpegResolvedPath,
    queueProgressStyleModel: queue.queueProgressStyleModel,
    queueMode: queue.queueMode,
    isIconViewMode: queue.isIconViewMode,
    isCarousel3dViewMode: queue.isCarousel3dViewMode,
    carouselAutoRotationSpeed: queue.carouselAutoRotationSpeed,
    iconViewSize: queue.iconViewSize,
    iconGridClass: queue.iconGridClass,
    queueRowVariant: queue.queueRowVariant,
    progressUpdateIntervalMs: settings.progressUpdateIntervalMs,
    hasBatchCompressBatches: batchCompress.hasBatchCompressBatches,
    activeStatusFilters: queue.activeStatusFilters,
    activeTypeFilters: queue.activeTypeFilters,
    filterText: queue.filterText,
    filterUseRegex: queue.filterUseRegex,
    filterRegexError: queue.filterRegexError,
    sortPrimary: queue.sortPrimary,
    sortPrimaryDirection: queue.sortPrimaryDirection,
    hasSelection: queue.hasSelection,
    hasActiveFilters: queue.hasActiveFilters,
    selectedJobIds: queue.selectedJobIds,
    expandedBatchIds: batchCompress.expandedBatchIds,
    sortCompareFn: queue.compareJobsForDisplay,
  });

  const queueContextMenu = useQueueContextMenu({
    jobs: state.jobs,
    selectedJobIds: queue.selectedJobIds,
    handleWaitJob: queue.handleWaitJob,
    handleResumeJob: queue.handleResumeJob,
    handleRestartJob: queue.handleRestartJob,
    handleCancelJob: queue.handleCancelJob,
    bulkCancel: queue.bulkCancel,
    bulkWait: queue.bulkWait,
    bulkResume: queue.bulkResume,
    bulkRestart: queue.bulkRestart,
    bulkMoveToTop: queue.bulkMoveToTop,
    bulkMoveToBottom: queue.bulkMoveToBottom,
    bulkDelete: queue.bulkDelete,
    openJobDetail: dialogs.dialogManager.openJobDetail,
    openJobCompare: dialogs.dialogManager.openJobCompare,
  });

  return {
    ...queue,
    selectionBarPinned,
    setSelectionBarPinned,
    queueOutputPolicy,
    setQueueOutputPolicy,
    queuePanelProps,
    queueTotalCount,
    jobs: state.jobs,
    queueError: state.queueError,
    completedCount: state.completedCount,
    lastDroppedRoot: state.lastDroppedRoot,
    dnd,
    queueContextMenu,
  };
}
