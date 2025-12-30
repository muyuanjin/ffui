import type { CompositeBatchCompressTask, TranscodeJob } from "@/types";
import { useDialogsDomain, usePresetsDomain, usePreviewDomain, useQueueDomain } from "@/MainApp.setup";

export function useQueuePanelOrchestrator() {
  const dialogs = useDialogsDomain();
  const presets = usePresetsDomain();
  const preview = usePreviewDomain();
  const queue = useQueueDomain();

  const addManualJobsFromFiles = () => presets.addManualJob("files");
  const addManualJobsFromFolder = () => presets.addManualJob("folder");

  const inspectJob = (job: TranscodeJob) => dialogs.dialogManager.openJobDetail(job);
  const previewJob = (job: TranscodeJob) => preview.openJobPreviewFromQueue(job);
  const compareJob = (job: TranscodeJob) => dialogs.dialogManager.openJobCompare(job);

  const toggleBatchExpanded = (batchId: string) => dialogs.batchCompress.toggleBatchExpanded(batchId);
  const openBatchDetail = (batch: CompositeBatchCompressTask) => preview.openBatchDetail(batch);

  const openJobContextMenu = (payload: { job: TranscodeJob; event: MouseEvent }) =>
    queue.queueContextMenu.openQueueContextMenuForJob(payload);
  const openBulkContextMenu = (event: MouseEvent) => queue.queueContextMenu.openQueueContextMenuForBulk(event);

  return {
    addManualJobsFromFiles,
    addManualJobsFromFolder,
    inspectJob,
    previewJob,
    compareJob,
    toggleBatchExpanded,
    openBatchDetail,
    openJobContextMenu,
    openBulkContextMenu,
  };
}
