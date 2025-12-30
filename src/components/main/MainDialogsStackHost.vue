<script setup lang="ts">
import { unref } from "vue";
import MainDialogsStack from "@/components/main/MainDialogsStack.vue";
import { useMainAppContext } from "@/MainApp.setup";

const emit = defineEmits<{
  (e: "openToolsSettings"): void;
}>();

const context = useMainAppContext();
</script>

<template>
  <MainDialogsStack
    :dialog-manager="context.dialogs.dialogManager"
    :presets="unref(context.presets)"
    :preset-pending-delete="unref(context.presetsModule.presetPendingDelete)"
    :presets-pending-batch-delete="unref(context.presetsModule.presetsPendingBatchDelete)"
    :queue-delete-confirm-open="unref(context.queue.queueDeleteConfirmOpen)"
    :queue-delete-confirm-selected-count="unref(context.queue.queueDeleteConfirmSelectedCount)"
    :queue-delete-confirm-terminal-count="unref(context.queue.queueDeleteConfirmTerminalCount)"
    :queue-delete-confirm-active-count="unref(context.queue.queueDeleteConfirmActiveCount)"
    :smart-config="unref(context.batchCompress.smartConfig)"
    :default-video-preset-id="unref(context.manualJobPresetId)"
    :queue-progress-style="unref(context.queue.queueProgressStyle)"
    :progress-update-interval-ms="unref(context.settings.progressUpdateIntervalMs)"
    :selected-job-preset="unref(context.preview.selectedJobPreset)"
    :job-detail-job="unref(context.jobDetailJob)"
    :job-detail-log-text="unref(context.jobDetailLogText)"
    :highlighted-log-html="unref(context.highlightedLogHtml)"
    :preview-url="unref(context.preview.previewUrl)"
    :preview-path="unref(context.preview.previewPath)"
    :preview-source-mode="unref(context.preview.previewSourceMode)"
    :preview-is-image="unref(context.preview.previewIsImage)"
    :preview-error="unref(context.preview.previewError)"
    :ffmpeg-resolved-path="unref(context.ffmpegResolvedPath)"
    :sort-compare-fn="context.queue.compareJobsForDisplay"
    @savePreset="context.presetsModule.handleSavePreset"
    @closeWizard="context.dialogs.dialogManager.closeWizard()"
    @closeParameterPanel="context.dialogs.dialogManager.closeParameterPanel()"
    @runBatchCompress="context.batchCompress.runBatchCompress"
    @closeBatchCompressWizard="context.batchCompress.closeBatchCompressWizard"
    @confirmDeletePreset="context.presetsModule.confirmDeletePreset"
    @cancelDeletePreset="context.presetsModule.cancelDeletePreset"
    @confirmDeletePresets="context.presetsModule.confirmBatchDeletePresets"
    @cancelDeletePresets="context.presetsModule.cancelBatchDeletePresets"
    @confirmQueueDeleteCancelAndDelete="context.queue.confirmQueueDeleteCancelAndDelete"
    @confirmQueueDeleteTerminalOnly="context.queue.confirmQueueDeleteTerminalOnly"
    @cancelQueueDelete="context.queue.cancelQueueDeleteConfirm"
    @closeJobDetail="context.dialogs.dialogManager.closeJobDetail()"
    @handleJobDetailExpandPreview="context.preview.handleJobDetailExpandPreview"
    @copyToClipboard="context.copyToClipboard($event)"
    @openJobPreviewFromQueue="context.preview.openJobPreviewFromQueue"
    @handleCancelJob="context.queue.handleCancelJob"
    @handleWaitJob="context.queue.handleWaitJob"
    @handleResumeJob="context.queue.handleResumeJob"
    @handleRestartJob="context.queue.handleRestartJob"
    @closeBatchDetail="context.dialogs.dialogManager.closeBatchDetail()"
    @handleExpandedPreviewError="context.preview.handleExpandedPreviewError"
    @handleExpandedImagePreviewError="context.preview.handleExpandedImagePreviewError"
    @closeExpandedPreview="context.preview.closeExpandedPreview"
    @setPreviewSourceMode="context.preview.setPreviewSourceMode"
    @openPreviewInSystemPlayer="context.preview.openPreviewInSystemPlayer"
    @importSmartPackConfirmed="context.handleImportSmartPackConfirmed"
    @importCommandsPresets="context.presetsModule.importPresetsCandidates"
    @openToolsSettings="emit('openToolsSettings')"
  />
</template>
