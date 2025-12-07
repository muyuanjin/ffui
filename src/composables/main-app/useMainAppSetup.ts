import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings, FFmpegPreset, TranscodeJob } from "@/types";
import { useMainAppShell } from "@/composables/main-app/useMainAppShell";
import { useMainAppDialogs } from "@/composables/main-app/useMainAppDialogs";
import { useMainAppSmartScan } from "@/composables/main-app/useMainAppSmartScan";
import { useMainAppPresets } from "@/composables/main-app/useMainAppPresets";
import { useMainAppQueue } from "@/composables/main-app/useMainAppQueue";
import { useMainAppSettings } from "@/composables/main-app/useMainAppSettings";
import { useMainAppMedia } from "@/composables/main-app/useMainAppMedia";
import { useMainAppPreview } from "@/composables/main-app/useMainAppPreview";
import { useMainAppDnDAndContextMenu } from "@/composables/main-app/useMainAppDnDAndContextMenu";
import { useQueueContextMenu } from "@/composables/main-app/useQueueContextMenu";
import { useJobLog } from "@/composables";
import { createQueuePanelProps } from "@/composables/main-app/queuePanelBindings";
import { copyToClipboard } from "@/lib/copyToClipboard";

export function useMainAppSetup() {
  const { t } = useI18n();

  const jobs = ref<TranscodeJob[]>([]);
  const queueError = ref<string | null>(null);
  const lastQueueSnapshotAtMs = ref<number | null>(null);
  const lastDroppedRoot = ref<string | null>(null);
  const presets = ref<FFmpegPreset[]>([]);
  const presetsLoadedFromBackend = ref(false);
  const manualJobPresetId = ref<string | null>(null);
  const completedCount = computed(() =>
    jobs.value.filter((job) => job.status === "completed").length,
  );

  const shell = useMainAppShell();
  const dialogs = useMainAppDialogs();

  const smartScan = useMainAppSmartScan({
    t,
    activeTab: shell.activeTab,
    jobs,
    presets,
    queueError,
    lastDroppedRoot,
    dialogManager: dialogs.dialogManager,
  });

  const presetsModule = useMainAppPresets({
    t,
    presets,
    presetsLoadedFromBackend,
    manualJobPresetId,
    dialogManager: dialogs.dialogManager,
    shell,
  });

  const queue = useMainAppQueue({
    t,
    jobs,
    queueError,
    lastQueueSnapshotAtMs,
    presets,
    manualJobPresetId,
    compositeSmartScanTasks: smartScan.compositeSmartScanTasks,
    compositeTasksById: smartScan.compositeTasksById,
  });

  const settings = useMainAppSettings({
    jobs,
    manualJobPresetId,
    smartConfig: smartScan.smartConfig,
  });

  const media = useMainAppMedia({
    t,
    activeTab: shell.activeTab,
  });

  const preview = useMainAppPreview({
    presets,
    dialogManager: dialogs.dialogManager,
    t,
  });

  const dnd = useMainAppDnDAndContextMenu({
    activeTab: shell.activeTab,
    inspectMediaForPath: media.inspectMediaForPath,
    enqueueManualJobFromPath: queue.enqueueManualJobFromPath,
    selectedJobIds: queue.selectedJobIds,
    bulkMoveSelectedJobsToTopInner: queue.bulkMoveSelectedJobsToTopInner,
  });

  const titleForTab = {
    queue: () => t("app.tabs.queue"),
    presets: () => t("app.tabs.presets"),
    media: () => t("app.tabs.media"),
    monitor: () => t("app.tabs.monitor"),
    settings: () => t("app.tabs.settings"),
  } as const;
  const subtitleForTab = {
    queue: () => t("app.queueHint"),
    presets: () => t("app.presetsHint"),
    media: () => t("app.mediaHint"),
    monitor: () => t("app.monitorHint"),
    settings: () => t("app.settingsHint"),
  } as const;
  const currentTitle = computed(
    () => titleForTab[shell.activeTab.value]?.() ?? titleForTab.queue(),
  );
  const currentSubtitle = computed(
    () => subtitleForTab[shell.activeTab.value]?.() ?? "",
  );

  const { dialogManager, selectedJobForDetail } = dialogs;

  // Best-effort resolution of concrete ffmpeg/ffprobe paths for UI display.
  // Prefer the backend-probed resolvedPath (which already accounts for
  // auto-download and PATH lookup) and fall back to the custom path stored in
  // AppSettings when status snapshots are not yet available.
  const ffmpegResolvedPath = computed(() => {
    const status = settings.toolStatuses.value.find(
      (s) => s.kind === "ffmpeg",
    );
    if (status?.resolvedPath) return status.resolvedPath;
    const tools = (settings.appSettings.value as any)?.tools as
      | import("@/types").ExternalToolSettings
      | undefined;
    return tools?.ffmpegPath ?? null;
  });

  const queuePanelProps = createQueuePanelProps({
    queueJobsForDisplay: queue.queueJobsForDisplay,
    visibleQueueItems: queue.visibleQueueItems,
    iconViewItems: queue.iconViewItems,
    queueModeProcessingJobs: queue.queueModeProcessingJobs,
    queueModeWaitingJobs: queue.queueModeWaitingJobs,
    presets,
    queueViewMode: queue.queueViewMode,
    // Expand bare `ffmpeg` tokens in the "full command" view using the
    // backend-resolved executable path so users can copy the actual command.
    ffmpegResolvedPath,
    queueProgressStyleModel: queue.queueProgressStyleModel,
    queueMode: queue.queueMode,
    isIconViewMode: queue.isIconViewMode,
    iconViewSize: queue.iconViewSize,
    iconGridClass: queue.iconGridClass,
    queueRowVariant: queue.queueRowVariant,
    progressUpdateIntervalMs: settings.progressUpdateIntervalMs,
    hasSmartScanBatches: smartScan.hasSmartScanBatches,
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
    expandedBatchIds: smartScan.expandedBatchIds,
    queueError,
  });

  const queueContextMenu = useQueueContextMenu({
    jobs,
    selectedJobIds: queue.selectedJobIds,
    handleWaitJob: queue.handleWaitJob,
    handleResumeJob: queue.handleResumeJob,
    handleRestartJob: queue.handleRestartJob,
    handleCancelJob: queue.handleCancelJob,
    bulkMoveToTop: queue.bulkMoveToTop,
    bulkMoveToBottom: queue.bulkMoveToBottom,
    bulkDelete: queue.bulkDelete,
    openJobDetail: dialogs.dialogManager.openJobDetail,
  });

  const {
    queueContextMenuVisible,
    queueContextMenuMode,
    queueContextMenuX,
    queueContextMenuY,
    queueContextMenuJobStatus,
    openQueueContextMenuForJob,
    openQueueContextMenuForBulk,
    closeQueueContextMenu,
    handleQueueContextInspect,
    handleQueueContextWait,
    handleQueueContextResume,
    handleQueueContextRestart,
    handleQueueContextCancel,
    handleQueueContextMoveToTop,
    handleQueueContextMoveToBottom,
    handleQueueContextDelete,
  } = queueContextMenu;

  const { highlightedLogHtml } = useJobLog({
    selectedJob: dialogManager.selectedJob,
  });

  const handleUpdateAppSettings = (next: AppSettings) => {
    settings.appSettings.value = next;
  };

  const mainApp = {
    jobs,
    queueError,
    lastDroppedRoot,
    presets,
    presetsLoadedFromBackend,
    settings,
    ...shell,
    ...dialogs,
    ...smartScan,
    ...settings,
    ...presetsModule,
    ...queue,
    ...media,
    ...preview,
    ...dnd,

    currentTitle,
    currentSubtitle,

    selectedJobForDetail,
    globalTaskbarProgressPercent: settings.globalTaskbarProgressPercent,
    compositeSmartScanTasks: smartScan.compositeSmartScanTasks,
    smartScanBatchMeta: smartScan.smartScanBatchMeta,
    highlightedLogHtml,
    copyToClipboard,

    // Additional bindings used only by the template but not originally
    // exposed on the instance.
    completedCount,
    queuePanelProps,
    ffmpegResolvedPath,
    handleUpdateAppSettings,

    // Queue context menu bindings used by the template.
    queueContextMenuVisible,
    queueContextMenuMode,
    queueContextMenuX,
    queueContextMenuY,
    queueContextMenuJobStatus,
    openQueueContextMenuForJob,
    openQueueContextMenuForBulk,
    closeQueueContextMenu,
    handleQueueContextInspect,
    handleQueueContextWait,
    handleQueueContextResume,
    handleQueueContextRestart,
    handleQueueContextCancel,
    handleQueueContextMoveToTop,
    handleQueueContextMoveToBottom,
    handleQueueContextDelete,
  };
  return { mainApp, manualJobPresetId };
}

export type MainAppSetup = ReturnType<typeof useMainAppSetup>;
