import { ref } from "vue";
import type { TranscodeJob, FFmpegPreset, CompositeSmartScanTask } from "@/types";

/**
 * 对话框管理 Composable
 *
 * @description 统一管理应用中所有对话框的打开/关闭状态
 * @returns 对话框状态和控制方法
 *
 * @example
 * ```typescript
 * const { wizardOpen, openWizard, closeWizard } = useDialogManager();
 * openWizard(); // 打开向导
 * closeWizard(); // 关闭向导
 * ```
 */
export function useDialogManager() {
  // 对话框状态
  const wizardOpen = ref(false);
  const parameterPanelOpen = ref(false);
  const smartScanOpen = ref(false);
  const jobDetailOpen = ref(false);
  const batchDetailOpen = ref(false);
  const previewOpen = ref(false);
  const deletePresetDialogOpen = ref(false);

  // 当前选中的项目(用于详情对话框)
  const selectedJob = ref<TranscodeJob | null>(null);
  const selectedBatch = ref<CompositeSmartScanTask | null>(null);
  const editingPreset = ref<FFmpegPreset | null>(null);

  // 打开方法
  const openWizard = (preset?: FFmpegPreset) => {
    editingPreset.value = preset ?? null;
    wizardOpen.value = true;
  };

  const openParameterPanel = (preset: FFmpegPreset) => {
    editingPreset.value = preset;
    parameterPanelOpen.value = true;
  };

  const openSmartScan = () => {
    smartScanOpen.value = true;
  };

  const openJobDetail = (job: TranscodeJob) => {
    selectedJob.value = job;
    jobDetailOpen.value = true;
  };

  const openBatchDetail = (batch: CompositeSmartScanTask) => {
    selectedBatch.value = batch;
    batchDetailOpen.value = true;
  };

  const openPreview = (job: TranscodeJob) => {
    selectedJob.value = job;
    previewOpen.value = true;
  };

  const openDeletePresetDialog = (preset: FFmpegPreset) => {
    editingPreset.value = preset;
    deletePresetDialogOpen.value = true;
  };

  // 关闭方法
  const closeWizard = () => {
    wizardOpen.value = false;
    editingPreset.value = null;
  };

  const closeParameterPanel = () => {
    parameterPanelOpen.value = false;
    editingPreset.value = null;
  };

  const closeSmartScan = () => {
    smartScanOpen.value = false;
  };

  const closeJobDetail = () => {
    jobDetailOpen.value = false;
    selectedJob.value = null;
  };

  const closeBatchDetail = () => {
    batchDetailOpen.value = false;
    selectedBatch.value = null;
  };

  const closePreview = () => {
    previewOpen.value = false;
    selectedJob.value = null;
  };

  const closeDeletePresetDialog = () => {
    deletePresetDialogOpen.value = false;
    editingPreset.value = null;
  };

  // 关闭所有对话框
  const closeAllDialogs = () => {
    wizardOpen.value = false;
    parameterPanelOpen.value = false;
    smartScanOpen.value = false;
    jobDetailOpen.value = false;
    batchDetailOpen.value = false;
    previewOpen.value = false;
    deletePresetDialogOpen.value = false;
    selectedJob.value = null;
    selectedBatch.value = null;
    editingPreset.value = null;
  };

  return {
    // 状态
    wizardOpen,
    parameterPanelOpen,
    smartScanOpen,
    jobDetailOpen,
    batchDetailOpen,
    previewOpen,
    deletePresetDialogOpen,
    selectedJob,
    selectedBatch,
    editingPreset,
    // 打开方法
    openWizard,
    openParameterPanel,
    openSmartScan,
    openJobDetail,
    openBatchDetail,
    openPreview,
    openDeletePresetDialog,
    // 关闭方法
    closeWizard,
    closeParameterPanel,
    closeSmartScan,
    closeJobDetail,
    closeBatchDetail,
    closePreview,
    closeDeletePresetDialog,
    closeAllDialogs,
  };
}
