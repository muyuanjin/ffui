<script setup lang="ts">
import DeletePresetDialog from "@/components/dialogs/DeletePresetDialog.vue";
import JobDetailDialog from "@/components/dialogs/JobDetailDialog.vue";
import BatchDetailDialog from "@/components/dialogs/BatchDetailDialog.vue";
import ExpandedPreviewDialog from "@/components/dialogs/ExpandedPreviewDialog.vue";
import JobCompareDialog from "@/components/dialogs/JobCompareDialog.vue";
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
  defaultVideoPresetId,
  queueProgressStyle,
  progressUpdateIntervalMs,
  selectedJobPreset,
  highlightedLogHtml,
  previewUrl,
  previewPath,
  previewIsImage,
  previewError,
  ffmpegResolvedPath,
  sortCompareFn,
} = defineProps<{
  dialogManager: UseDialogManagerReturn;
  presets: FFmpegPreset[];
  presetPendingDelete: FFmpegPreset | null;
  smartConfig: any;
  defaultVideoPresetId: string | null;
  queueProgressStyle: QueueProgressStyle;
  progressUpdateIntervalMs: number;
  selectedJobPreset: FFmpegPreset | null;
  jobDetailLogText: string;
  highlightedLogHtml: string;
  previewUrl: string | null;
  previewPath: string | null;
  previewIsImage: boolean;
  previewError: string | null;
  ffmpegResolvedPath: string | null;
  /** 排序比较函数，用于对批次子任务进行排序 */
  sortCompareFn?: (a: TranscodeJob, b: TranscodeJob) => number;
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

const openCompareFromJobDetail = () => {
  const job = dialogManager.selectedJob.value;
  if (!job) return;
  dialogManager.openJobCompare(job);
};
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
    :default-video-preset-id="defaultVideoPresetId"
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
    :job-detail-log-text="jobDetailLogText"
    :highlighted-log-html="highlightedLogHtml"
    :ffmpeg-resolved-path="ffmpegResolvedPath"
    @update:open="(val) => { if (!val) emit('closeJobDetail'); }"
    @expand-preview="emit('handleJobDetailExpandPreview')"
    @compare="openCompareFromJobDetail"
    @copy-command="emit('copyToClipboard', dialogManager.selectedJob.value?.ffmpegCommand || '')"
  />

  <BatchDetailDialog
    :open="dialogManager.batchDetailOpen.value"
    :batch="dialogManager.selectedBatch.value"
    :presets="presets"
    :progress-style="queueProgressStyle"
    :progress-update-interval-ms="progressUpdateIntervalMs"
    :sort-compare-fn="sortCompareFn"
    @update:open="(val) => { if (!val) emit('closeBatchDetail'); }"
    @inspect-job="dialogManager.openJobDetail($event)"
    @preview-job="emit('openJobPreviewFromQueue', $event)"
    @compare-job="dialogManager.openJobCompare($event)"
    @cancel-job="emit('handleCancelJob', $event)"
    @wait-job="emit('handleWaitJob', $event)"
    @resume-job="emit('handleResumeJob', $event)"
    @restart-job="emit('handleRestartJob', $event)"
  />

  <ExpandedPreviewDialog
    :open="dialogManager.previewOpen.value"
    :job="dialogManager.selectedJob.value"
    :preview-url="previewUrl"
    :preview-path="previewPath"
    :is-image="previewIsImage"
    :error="previewError"
    @update:open="(open) => { if (!open) emit('closeExpandedPreview'); }"
    @video-error="emit('handleExpandedPreviewError')"
    @image-error="emit('handleExpandedImagePreviewError')"
    @open-in-system-player="emit('openPreviewInSystemPlayer')"
    @copy-path="emit('copyToClipboard', dialogManager.selectedJob.value?.inputPath || dialogManager.selectedJob.value?.outputPath || '')"
  />

  <JobCompareDialog
    :open="dialogManager.jobCompareOpen.value"
    :job="dialogManager.selectedJob.value"
    @update:open="(open) => { if (!open) dialogManager.closeJobCompare(); }"
  />

  <SmartPresetOnboardingWizard
    v-if="dialogManager.smartPresetImportOpen.value"
    :open="dialogManager.smartPresetImportOpen.value"
    @update:open="(open) => { if (!open) dialogManager.closeSmartPresetImport(); }"
    @confirmed="(presets) => emit('importSmartPackConfirmed', presets)"
    @openToolsSettings="emit('openToolsSettings')"
  />
</template>
