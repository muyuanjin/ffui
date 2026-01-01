import { computed, unref } from "vue";
import { copyToClipboard } from "@/lib/copyToClipboard";
import {
  useDialogsDomain,
  usePresetsDomain,
  usePreviewDomain,
  useQueueDomain,
  useSettingsDomain,
} from "@/MainApp.setup";

export function useMainDialogsStackOrchestrator() {
  const dialogs = useDialogsDomain();
  const presets = usePresetsDomain();
  const queue = useQueueDomain();
  const preview = usePreviewDomain();
  const settings = useSettingsDomain();

  const stackProps = computed(() => {
    return {
      dialogManager: dialogs.dialogManager,
      presets: unref(presets.presets),
      presetPendingDelete: unref(presets.presetPendingDelete),
      presetsPendingBatchDelete: unref(presets.presetsPendingBatchDelete),
      queueDeleteConfirmOpen: unref(queue.queueDeleteConfirmOpen),
      queueDeleteConfirmSelectedCount: unref(queue.queueDeleteConfirmSelectedCount),
      queueDeleteConfirmTerminalCount: unref(queue.queueDeleteConfirmTerminalCount),
      queueDeleteConfirmActiveCount: unref(queue.queueDeleteConfirmActiveCount),
      smartConfig: unref(dialogs.batchCompress.smartConfig),
      defaultVideoPresetId: unref(presets.manualJobPresetId),
      queueProgressStyle: unref(queue.queueProgressStyle),
      progressUpdateIntervalMs: unref(settings.progressUpdateIntervalMs),
      selectedJobPreset: unref(preview.selectedJobPreset),
      jobDetailJob: unref(dialogs.jobDetailJob),
      jobDetailLogText: unref(dialogs.jobDetailLogText),
      highlightedLogHtml: unref(dialogs.highlightedLogHtml),
      previewUrl: unref(preview.previewUrl),
      previewPath: unref(preview.previewPath),
      previewSourceMode: unref(preview.previewSourceMode),
      previewIsImage: unref(preview.previewIsImage),
      previewError: unref(preview.previewError),
      ffmpegResolvedPath: unref(settings.ffmpegResolvedPath),
      sortCompareFn: queue.compareJobsForDisplay,
    };
  });

  const stackListeners = {
    savePreset: presets.handleSavePreset,
    closeWizard: () => dialogs.dialogManager.closeWizard(),
    closeParameterPanel: () => dialogs.dialogManager.closeParameterPanel(),
    runBatchCompress: dialogs.batchCompress.runBatchCompress,
    closeBatchCompressWizard: dialogs.batchCompress.closeBatchCompressWizard,
    confirmDeletePreset: presets.confirmDeletePreset,
    cancelDeletePreset: presets.cancelDeletePreset,
    confirmDeletePresets: presets.confirmBatchDeletePresets,
    cancelDeletePresets: presets.cancelBatchDeletePresets,
    confirmQueueDeleteCancelAndDelete: queue.confirmQueueDeleteCancelAndDelete,
    confirmQueueDeleteTerminalOnly: queue.confirmQueueDeleteTerminalOnly,
    cancelQueueDelete: queue.cancelQueueDeleteConfirm,
    closeJobDetail: () => dialogs.dialogManager.closeJobDetail(),
    handleJobDetailExpandPreview: preview.handleJobDetailExpandPreview,
    measureJobVmaf: presets.handleMeasureJobVmaf,
    copyToClipboard,
    openJobPreviewFromQueue: preview.openJobPreviewFromQueue,
    handleCancelJob: queue.handleCancelJob,
    handleWaitJob: queue.handleWaitJob,
    handleResumeJob: queue.handleResumeJob,
    handleRestartJob: queue.handleRestartJob,
    closeBatchDetail: () => dialogs.dialogManager.closeBatchDetail(),
    handleExpandedPreviewError: preview.handleExpandedPreviewError,
    handleExpandedImagePreviewError: preview.handleExpandedImagePreviewError,
    closeExpandedPreview: preview.closeExpandedPreview,
    setPreviewSourceMode: preview.setPreviewSourceMode,
    openPreviewInSystemPlayer: preview.openPreviewInSystemPlayer,
    importSmartPackConfirmed: presets.handleImportSmartPackConfirmedWithOnboarding,
    importCommandsPresets: presets.importPresetsCandidates,
  } as const;

  return {
    stackProps,
    stackListeners,
  };
}
