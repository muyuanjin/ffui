import { invokeCommand } from "./invokeCommand";
import type { TranscodeJob } from "@/types";
import { hasTauri } from "../backend.core";

export const cancelTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invokeCommand<boolean>("cancel_transcode_job", { jobId });
};

export const cancelTranscodeJobsBulk = async (jobIds: string[]): Promise<boolean> => {
  return invokeCommand<boolean>("cancel_transcode_jobs_bulk", { jobIds });
};

export const waitTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invokeCommand<boolean>("wait_transcode_job", { jobId });
};

export const waitTranscodeJobsBulk = async (jobIds: string[]): Promise<boolean> => {
  return invokeCommand<boolean>("wait_transcode_jobs_bulk", { jobIds });
};

export const resumeTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invokeCommand<boolean>("resume_transcode_job", { jobId });
};

export const resumeTranscodeJobsBulk = async (jobIds: string[]): Promise<boolean> => {
  return invokeCommand<boolean>("resume_transcode_jobs_bulk", { jobIds });
};

export const restartTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invokeCommand<boolean>("restart_transcode_job", { jobId });
};

export const restartTranscodeJobsBulk = async (jobIds: string[]): Promise<boolean> => {
  return invokeCommand<boolean>("restart_transcode_jobs_bulk", { jobIds });
};

export const deleteTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invokeCommand<boolean>("delete_transcode_job", { jobId });
};

export const deleteTranscodeJobsBulk = async (jobIds: string[]): Promise<boolean> => {
  return invokeCommand<boolean>("delete_transcode_jobs_bulk", { jobIds });
};

export const deleteBatchCompressBatchOnBackend = async (batchId: string): Promise<boolean> => {
  return invokeCommand<boolean>("delete_batch_compress_batch", { batchId });
};

export const deleteBatchCompressBatchesBulk = async (batchIds: string[]): Promise<boolean> => {
  return invokeCommand<boolean>("delete_batch_compress_batches_bulk", { batchIds });
};

export const reorderQueue = async (orderedIds: string[]): Promise<boolean> => {
  return invokeCommand<boolean>("reorder_queue", { orderedIds });
};

export const loadJobDetail = async (jobId: string): Promise<TranscodeJob | null> => {
  return invokeCommand<TranscodeJob | null>("get_job_detail", { jobId });
};

export const loadPreviewDataUrl = async (previewPath: string): Promise<string> => {
  return invokeCommand<string>("get_preview_data_url", { previewPath });
};

/**
 * Ensure a job has a readable preview image on disk. If the preview image was
 * deleted or cannot be read, the backend will regenerate it using the latest
 * previewCapturePercent setting and update the job's previewPath.
 *
 * Returns the resolved preview path when a preview is available, otherwise null.
 */
export const ensureJobPreview = async (jobId: string): Promise<string | null> => {
  if (!hasTauri()) return null;
  return invokeCommand<string | null>("ensure_job_preview", { jobId });
};

export const ensureJobPreviewVariant = async (jobId: string, heightPx: number): Promise<string | null> => {
  if (!hasTauri()) return null;
  const normalized = Math.max(0, Math.floor(Number(heightPx)));
  return invokeCommand<string | null>("ensure_job_preview_variant", { jobId, heightPx: normalized });
};
