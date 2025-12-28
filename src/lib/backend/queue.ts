import { invoke } from "@tauri-apps/api/core";
import type { TranscodeJob } from "@/types";
import { hasTauri } from "../backend.core";

export const cancelTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invoke<boolean>("cancel_transcode_job", {
    jobId,
    job_id: jobId,
  });
};

export const cancelTranscodeJobsBulk = async (jobIds: string[]): Promise<boolean> => {
  return invoke<boolean>("cancel_transcode_jobs_bulk", {
    jobIds,
    job_ids: jobIds,
  });
};

export const waitTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invoke<boolean>("wait_transcode_job", {
    jobId,
    job_id: jobId,
  });
};

export const waitTranscodeJobsBulk = async (jobIds: string[]): Promise<boolean> => {
  return invoke<boolean>("wait_transcode_jobs_bulk", {
    jobIds,
    job_ids: jobIds,
  });
};

export const resumeTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invoke<boolean>("resume_transcode_job", {
    jobId,
    job_id: jobId,
  });
};

export const resumeTranscodeJobsBulk = async (jobIds: string[]): Promise<boolean> => {
  return invoke<boolean>("resume_transcode_jobs_bulk", {
    jobIds,
    job_ids: jobIds,
  });
};

export const restartTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invoke<boolean>("restart_transcode_job", {
    jobId,
    job_id: jobId,
  });
};

export const restartTranscodeJobsBulk = async (jobIds: string[]): Promise<boolean> => {
  return invoke<boolean>("restart_transcode_jobs_bulk", {
    jobIds,
    job_ids: jobIds,
  });
};

export const deleteTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invoke<boolean>("delete_transcode_job", {
    jobId,
    job_id: jobId,
  });
};

export const deleteTranscodeJobsBulk = async (jobIds: string[]): Promise<boolean> => {
  return invoke<boolean>("delete_transcode_jobs_bulk", {
    jobIds,
    job_ids: jobIds,
  });
};

export const deleteBatchCompressBatchOnBackend = async (batchId: string): Promise<boolean> => {
  return invoke<boolean>("delete_batch_compress_batch", {
    // 同时传递 camelCase 与 snake_case，避免后端参数名调整导致调用失效。
    batchId,
    batch_id: batchId,
  });
};

export const deleteBatchCompressBatchesBulk = async (batchIds: string[]): Promise<boolean> => {
  return invoke<boolean>("delete_batch_compress_batches_bulk", {
    batchIds,
    batch_ids: batchIds,
  });
};

export const reorderQueue = async (orderedIds: string[]): Promise<boolean> => {
  return invoke<boolean>("reorder_queue", {
    orderedIds,
    ordered_ids: orderedIds,
    jobIds: orderedIds,
    job_ids: orderedIds,
  });
};

export const loadJobDetail = async (jobId: string): Promise<TranscodeJob | null> => {
  return invoke<TranscodeJob | null>("get_job_detail", {
    jobId,
    job_id: jobId,
  });
};

export const loadPreviewDataUrl = async (previewPath: string): Promise<string> => {
  return invoke<string>("get_preview_data_url", {
    // Accept both camelCase and snake_case to stay resilient to Rust-side renames.
    previewPath,
    preview_path: previewPath,
  });
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
  return invoke<string | null>("ensure_job_preview", {
    jobId,
    job_id: jobId,
  });
};

export const ensureJobPreviewVariant = async (jobId: string, heightPx: number): Promise<string | null> => {
  if (!hasTauri()) return null;
  const normalized = Math.max(0, Math.floor(Number(heightPx)));
  return invoke<string | null>("ensure_job_preview_variant", {
    jobId,
    job_id: jobId,
    heightPx: normalized,
    height_px: normalized,
  });
};
