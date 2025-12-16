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
  const jobCompareOpen = ref(false);
  const deletePresetDialogOpen = ref(false);
  const smartPresetImportOpen = ref(false);

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

  const openJobCompare = (job: TranscodeJob) => {
    selectedJob.value = job;
    jobCompareOpen.value = true;
  };

  const openDeletePresetDialog = (preset: FFmpegPreset) => {
    editingPreset.value = preset;
    deletePresetDialogOpen.value = true;
  };

  const openSmartPresetImport = () => {
    smartPresetImportOpen.value = true;
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
    // 只有当预览也关闭时才清空 selectedJob，避免在“任务详情 + 预览”并存时
    // 关闭任一对话框导致另一个对话框变成“空详情”。
    if (!previewOpen.value && !jobCompareOpen.value) {
      selectedJob.value = null;
    }
  };

  const closeBatchDetail = () => {
    batchDetailOpen.value = false;
    selectedBatch.value = null;
  };

  const closePreview = () => {
    previewOpen.value = false;
    // 同理：只有在任务详情已关闭时才清空 selectedJob，保证
    // 从任务详情展开预览再关闭时，详情内容不会变成空白。
    if (!jobDetailOpen.value && !jobCompareOpen.value) {
      selectedJob.value = null;
    }
  };

  const closeJobCompare = () => {
    jobCompareOpen.value = false;
    if (!jobDetailOpen.value && !previewOpen.value) {
      selectedJob.value = null;
    }
  };

  const closeDeletePresetDialog = () => {
    deletePresetDialogOpen.value = false;
    editingPreset.value = null;
  };

  const closeSmartPresetImport = () => {
    smartPresetImportOpen.value = false;
  };

  // 关闭所有对话框
  const closeAllDialogs = () => {
    wizardOpen.value = false;
    parameterPanelOpen.value = false;
    smartScanOpen.value = false;
    jobDetailOpen.value = false;
    batchDetailOpen.value = false;
    previewOpen.value = false;
    jobCompareOpen.value = false;
    deletePresetDialogOpen.value = false;
    smartPresetImportOpen.value = false;
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
    jobCompareOpen,
    deletePresetDialogOpen,
    smartPresetImportOpen,
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
    openJobCompare,
    openDeletePresetDialog,
    openSmartPresetImport,
    // 关闭方法
    closeWizard,
    closeParameterPanel,
    closeSmartScan,
    closeJobDetail,
    closeBatchDetail,
    closePreview,
    closeJobCompare,
    closeDeletePresetDialog,
    closeSmartPresetImport,
    closeAllDialogs,
  };
}

export type UseDialogManagerReturn = ReturnType<typeof useDialogManager>;
