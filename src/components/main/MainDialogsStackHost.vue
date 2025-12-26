<script setup lang="ts">
import { unref } from "vue";
import MainDialogsStack from "@/components/main/MainDialogsStack.vue";

type MainAppBindings = Record<string, any>;

const props = defineProps<{
  mainApp: MainAppBindings;
  manualJobPresetId: string | null;
}>();

const emit = defineEmits<{
  (e: "openToolsSettings"): void;
}>();
</script>

<template>
  <MainDialogsStack
    :dialog-manager="props.mainApp.dialogManager"
    :presets="unref(props.mainApp.presets)"
    :preset-pending-delete="unref(props.mainApp.presetPendingDelete)"
    :presets-pending-batch-delete="unref(props.mainApp.presetsPendingBatchDelete)"
    :smart-config="unref(props.mainApp.smartConfig)"
    :default-video-preset-id="props.manualJobPresetId"
    :queue-progress-style="unref(props.mainApp.queueProgressStyle)"
    :progress-update-interval-ms="unref(props.mainApp.progressUpdateIntervalMs)"
    :selected-job-preset="unref(props.mainApp.selectedJobPreset)"
    :job-detail-job="unref(props.mainApp.jobDetailJob)"
    :job-detail-log-text="unref(props.mainApp.jobDetailLogText)"
    :highlighted-log-html="unref(props.mainApp.highlightedLogHtml)"
    :preview-url="unref(props.mainApp.previewUrl)"
    :preview-path="unref(props.mainApp.previewPath)"
    :preview-source-mode="unref(props.mainApp.previewSourceMode)"
    :preview-is-image="unref(props.mainApp.previewIsImage)"
    :preview-error="unref(props.mainApp.previewError)"
    :ffmpeg-resolved-path="unref(props.mainApp.ffmpegResolvedPath)"
    :sort-compare-fn="unref(props.mainApp.compareJobsForDisplay)"
    @savePreset="props.mainApp.handleSavePreset"
    @closeWizard="props.mainApp.dialogManager.closeWizard()"
    @closeParameterPanel="props.mainApp.dialogManager.closeParameterPanel()"
    @runBatchCompress="props.mainApp.runBatchCompress"
    @closeBatchCompressWizard="props.mainApp.closeBatchCompressWizard"
    @confirmDeletePreset="props.mainApp.confirmDeletePreset"
    @cancelDeletePreset="props.mainApp.cancelDeletePreset"
    @confirmDeletePresets="props.mainApp.confirmBatchDeletePresets"
    @cancelDeletePresets="props.mainApp.cancelBatchDeletePresets"
    @closeJobDetail="props.mainApp.dialogManager.closeJobDetail()"
    @handleJobDetailExpandPreview="props.mainApp.handleJobDetailExpandPreview"
    @copyToClipboard="props.mainApp.copyToClipboard($event)"
    @openJobPreviewFromQueue="props.mainApp.openJobPreviewFromQueue"
    @handleCancelJob="props.mainApp.handleCancelJob"
    @handleWaitJob="props.mainApp.handleWaitJob"
    @handleResumeJob="props.mainApp.handleResumeJob"
    @handleRestartJob="props.mainApp.handleRestartJob"
    @closeBatchDetail="props.mainApp.dialogManager.closeBatchDetail()"
    @handleExpandedPreviewError="props.mainApp.handleExpandedPreviewError"
    @handleExpandedImagePreviewError="props.mainApp.handleExpandedImagePreviewError"
    @closeExpandedPreview="props.mainApp.closeExpandedPreview"
    @setPreviewSourceMode="props.mainApp.setPreviewSourceMode"
    @openPreviewInSystemPlayer="props.mainApp.openPreviewInSystemPlayer"
    @importSmartPackConfirmed="props.mainApp.handleImportSmartPackConfirmed"
    @importCommandsPresets="props.mainApp.importPresetsCandidates"
    @openToolsSettings="emit('openToolsSettings')"
  />
</template>
