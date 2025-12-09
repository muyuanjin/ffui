<script setup lang="ts">
import DeletePresetDialog from "@/components/dialogs/DeletePresetDialog.vue";
import JobDetailDialog from "@/components/dialogs/JobDetailDialog.vue";
import BatchDetailDialog from "@/components/dialogs/BatchDetailDialog.vue";
import ExpandedPreviewDialog from "@/components/dialogs/ExpandedPreviewDialog.vue";
import ParameterWizard from "@/components/ParameterWizard.vue";
import UltimateParameterPanel from "@/components/UltimateParameterPanel.vue";
import SmartScanWizard from "@/components/SmartScanWizard.vue";
import SmartPresetOnboardingWizard from "@/components/dialogs/SmartPresetOnboardingWizard.vue";
import type { FFmpegPreset, TranscodeJob, QueueProgressStyle } from "@/types";
import type { UseDialogManagerReturn } from "@/composables/useDialogManager";

const {
  dialogManager,
  presets,
  presetPendingDelete,
  smartConfig,
  queueProgressStyle,
  progressUpdateIntervalMs,
  selectedJobPreset,
  highlightedLogHtml,
  previewUrl,
  previewIsImage,
  previewError,
  ffmpegResolvedPath,
} = defineProps<{
  dialogManager: UseDialogManagerReturn;
  presets: FFmpegPreset[];
  presetPendingDelete: FFmpegPreset | null;
  smartConfig: any;
  queueProgressStyle: QueueProgressStyle;
  progressUpdateIntervalMs: number;
  selectedJobPreset: FFmpegPreset | null;
  highlightedLogHtml: string;
  previewUrl: string | null;
  previewIsImage: boolean;
  previewError: string | null;
  ffmpegResolvedPath: string | null;
}>();

const emit = defineEmits<{
  (e: "savePreset", preset: FFmpegPreset): void;
  (e: "closeWizard"): void;
  (e: "closeParameterPanel"): void;
  (e: "runSmartScan", config: any): void;
  (e: "closeSmartScanWizard"): void;
  (e: "confirmDeletePreset"): void;
  (e: "cancelDeletePreset"): void;
  (e: "closeJobDetail"): void;
  (e: "handleJobDetailExpandPreview"): void;
  (e: "copyToClipboard", value: string): void;
  (e: "openJobPreviewFromQueue", job: TranscodeJob): void;
  (e: "handleCancelJob", jobId: string): void;
  (e: "handleWaitJob", jobId: string): void;
  (e: "handleResumeJob", jobId: string): void;
  (e: "handleRestartJob", jobId: string): void;
  (e: "closeBatchDetail"): void;
  (e: "handleExpandedPreviewError"): void;
  (e: "handleExpandedImagePreviewError"): void;
  (e: "closeExpandedPreview"): void;
  (e: "openPreviewInSystemPlayer"): void;
  (e: "importSmartPackConfirmed", presets: FFmpegPreset[]): void;
  (e: "openToolsSettings"): void;
}>();
</script>

<template>
  <ParameterWizard
    v-if="dialogManager.wizardOpen.value"
    :initial-preset="dialogManager.editingPreset.value"
    @save="emit('savePreset', $event)"
    @cancel="emit('closeWizard')"
  />

  <UltimateParameterPanel
    v-if="dialogManager.parameterPanelOpen.value && dialogManager.editingPreset.value"
    :initial-preset="dialogManager.editingPreset.value"
    @save="emit('savePreset', $event)"
    @cancel="emit('closeParameterPanel')"
  />

  <SmartScanWizard
    v-if="dialogManager.smartScanOpen.value"
    :initial-config="smartConfig"
    :presets="presets"
    @run="emit('runSmartScan', $event)"
    @cancel="emit('closeSmartScanWizard')"
  />

  <DeletePresetDialog
    :open="!!presetPendingDelete"
    :preset="presetPendingDelete"
    @update:open="$event => $event ? undefined : emit('cancelDeletePreset')"
    @confirm="emit('confirmDeletePreset')"
    @cancel="emit('cancelDeletePreset')"
  />

  <JobDetailDialog
    :open="dialogManager.jobDetailOpen.value"
    :job="dialogManager.selectedJob.value"
    :preset="selectedJobPreset"
    :highlighted-log-html="highlightedLogHtml"
    :ffmpeg-resolved-path="ffmpegResolvedPath"
    @update:open="(val) => { if (!val) emit('closeJobDetail'); }"
    @expand-preview="emit('handleJobDetailExpandPreview')"
    @copy-command="emit('copyToClipboard', dialogManager.selectedJob.value?.ffmpegCommand || '')"
  />

  <BatchDetailDialog
    :open="dialogManager.batchDetailOpen.value"
    :batch="dialogManager.selectedBatch.value"
    :presets="presets"
    :progress-style="queueProgressStyle"
    :progress-update-interval-ms="progressUpdateIntervalMs"
    @update:open="(val) => { if (!val) emit('closeBatchDetail'); }"
    @inspect-job="emit('openJobPreviewFromQueue', $event)"
    @preview-job="emit('openJobPreviewFromQueue', $event)"
    @cancel-job="emit('handleCancelJob', $event)"
    @wait-job="emit('handleWaitJob', $event)"
    @resume-job="emit('handleResumeJob', $event)"
    @restart-job="emit('handleRestartJob', $event)"
  />

  <ExpandedPreviewDialog
    :open="dialogManager.previewOpen.value"
    :job="dialogManager.selectedJob.value"
    :preview-url="previewUrl"
    :is-image="previewIsImage"
    :error="previewError"
    @update:open="(open) => { if (!open) emit('closeExpandedPreview'); }"
    @video-error="emit('handleExpandedPreviewError')"
    @image-error="emit('handleExpandedImagePreviewError')"
    @open-in-system-player="emit('openPreviewInSystemPlayer')"
    @copy-path="emit('copyToClipboard', dialogManager.selectedJob.value?.inputPath || dialogManager.selectedJob.value?.outputPath || '')"
  />

  <SmartPresetOnboardingWizard
    v-if="dialogManager.smartPresetImportOpen.value"
    :open="dialogManager.smartPresetImportOpen.value"
    @update:open="(open) => { if (!open) dialogManager.closeSmartPresetImport(); }"
    @confirmed="(presets) => emit('importSmartPackConfirmed', presets)"
    @openToolsSettings="emit('openToolsSettings')"
  />
</template>
