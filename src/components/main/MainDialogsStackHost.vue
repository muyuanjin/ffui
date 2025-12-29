<script setup lang="ts">
import { unref } from "vue";
import MainDialogsStack from "@/components/main/MainDialogsStack.vue";
import type { MainAppSetup } from "@/composables/main-app/useMainAppSetup";

const props = defineProps<{
  setup: MainAppSetup;
}>();

const emit = defineEmits<{
  (e: "openToolsSettings"): void;
}>();
</script>

<template>
  <MainDialogsStack
    :dialog-manager="props.setup.dialogs.dialogManager"
    :presets="unref(props.setup.presets)"
    :preset-pending-delete="unref(props.setup.presetsModule.presetPendingDelete)"
    :presets-pending-batch-delete="unref(props.setup.presetsModule.presetsPendingBatchDelete)"
    :queue-delete-confirm-open="unref(props.setup.queue.queueDeleteConfirmOpen)"
    :queue-delete-confirm-selected-count="unref(props.setup.queue.queueDeleteConfirmSelectedCount)"
    :queue-delete-confirm-terminal-count="unref(props.setup.queue.queueDeleteConfirmTerminalCount)"
    :queue-delete-confirm-active-count="unref(props.setup.queue.queueDeleteConfirmActiveCount)"
    :smart-config="unref(props.setup.batchCompress.smartConfig)"
    :default-video-preset-id="unref(props.setup.manualJobPresetId)"
    :queue-progress-style="unref(props.setup.queue.queueProgressStyle)"
    :progress-update-interval-ms="unref(props.setup.settings.progressUpdateIntervalMs)"
    :selected-job-preset="unref(props.setup.preview.selectedJobPreset)"
    :job-detail-job="unref(props.setup.jobDetailJob)"
    :job-detail-log-text="unref(props.setup.jobDetailLogText)"
    :highlighted-log-html="unref(props.setup.highlightedLogHtml)"
    :preview-url="unref(props.setup.preview.previewUrl)"
    :preview-path="unref(props.setup.preview.previewPath)"
    :preview-source-mode="unref(props.setup.preview.previewSourceMode)"
    :preview-is-image="unref(props.setup.preview.previewIsImage)"
    :preview-error="unref(props.setup.preview.previewError)"
    :ffmpeg-resolved-path="unref(props.setup.ffmpegResolvedPath)"
    :sort-compare-fn="props.setup.queue.compareJobsForDisplay"
    @savePreset="props.setup.presetsModule.handleSavePreset"
    @closeWizard="props.setup.dialogs.dialogManager.closeWizard()"
    @closeParameterPanel="props.setup.dialogs.dialogManager.closeParameterPanel()"
    @runBatchCompress="props.setup.batchCompress.runBatchCompress"
    @closeBatchCompressWizard="props.setup.batchCompress.closeBatchCompressWizard"
    @confirmDeletePreset="props.setup.presetsModule.confirmDeletePreset"
    @cancelDeletePreset="props.setup.presetsModule.cancelDeletePreset"
    @confirmDeletePresets="props.setup.presetsModule.confirmBatchDeletePresets"
    @cancelDeletePresets="props.setup.presetsModule.cancelBatchDeletePresets"
    @confirmQueueDeleteCancelAndDelete="props.setup.queue.confirmQueueDeleteCancelAndDelete"
    @confirmQueueDeleteTerminalOnly="props.setup.queue.confirmQueueDeleteTerminalOnly"
    @cancelQueueDelete="props.setup.queue.cancelQueueDeleteConfirm"
    @closeJobDetail="props.setup.dialogs.dialogManager.closeJobDetail()"
    @handleJobDetailExpandPreview="props.setup.preview.handleJobDetailExpandPreview"
    @copyToClipboard="props.setup.copyToClipboard($event)"
    @openJobPreviewFromQueue="props.setup.preview.openJobPreviewFromQueue"
    @handleCancelJob="props.setup.queue.handleCancelJob"
    @handleWaitJob="props.setup.queue.handleWaitJob"
    @handleResumeJob="props.setup.queue.handleResumeJob"
    @handleRestartJob="props.setup.queue.handleRestartJob"
    @closeBatchDetail="props.setup.dialogs.dialogManager.closeBatchDetail()"
    @handleExpandedPreviewError="props.setup.preview.handleExpandedPreviewError"
    @handleExpandedImagePreviewError="props.setup.preview.handleExpandedImagePreviewError"
    @closeExpandedPreview="props.setup.preview.closeExpandedPreview"
    @setPreviewSourceMode="props.setup.preview.setPreviewSourceMode"
    @openPreviewInSystemPlayer="props.setup.preview.openPreviewInSystemPlayer"
    @importSmartPackConfirmed="props.setup.handleImportSmartPackConfirmed"
    @importCommandsPresets="props.setup.presetsModule.importPresetsCandidates"
    @openToolsSettings="emit('openToolsSettings')"
  />
</template>
