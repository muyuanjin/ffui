import { invoke } from "@tauri-apps/api/core";

import type {
  AppSettings,
  AutoCompressResult,
  CpuUsageSnapshot,
  ExternalToolStatus,
  GpuUsageSnapshot,
  FFmpegPreset,
  JobSource,
  JobType,
  SmartScanConfig,
  QueueState,
  TranscodeJob,
} from "../types";

export const hasTauri = () => {
  if (typeof window === "undefined") return false;
  const w = window as any;
  // In Tauri 2, `__TAURI_IPC__` is always present in the webview. `__TAURI__`
  // exists only when `withGlobalTauri` is enabled. We treat either as Tauri.
  return "__TAURI_IPC__" in w || "__TAURI__" in w;
};

export const loadAppSettings = async (): Promise<AppSettings> => {
  return invoke<AppSettings>("get_app_settings");
};

export const saveAppSettings = async (settings: AppSettings): Promise<AppSettings> => {
  return invoke<AppSettings>("save_app_settings", { settings });
};

export const loadSmartScanDefaults = async (): Promise<SmartScanConfig> => {
  return invoke<SmartScanConfig>("get_smart_scan_defaults");
};

export const saveSmartScanDefaults = async (
  config: SmartScanConfig,
): Promise<SmartScanConfig> => {
  return invoke<SmartScanConfig>("save_smart_scan_defaults", { config });
};

export const runAutoCompress = async (
  rootPath: string,
  config: SmartScanConfig,
): Promise<AutoCompressResult> => {
  return invoke<AutoCompressResult>("run_auto_compress", { rootPath, config });
};

export const fetchCpuUsage = async (): Promise<CpuUsageSnapshot> => {
  return invoke<CpuUsageSnapshot>("get_cpu_usage");
};

export const fetchGpuUsage = async (): Promise<GpuUsageSnapshot> => {
  return invoke<GpuUsageSnapshot>("get_gpu_usage");
};

export const fetchExternalToolStatuses = async (): Promise<ExternalToolStatus[]> => {
  return invoke<ExternalToolStatus[]>("get_external_tool_statuses");
};

export const loadPresets = async (): Promise<FFmpegPreset[]> => {
  return invoke<FFmpegPreset[]>("get_presets");
};

export const savePresetOnBackend = async (
  preset: FFmpegPreset,
): Promise<FFmpegPreset[]> => {
  return invoke<FFmpegPreset[]>("save_preset", { preset });
};

export const deletePresetOnBackend = async (
  presetId: string,
): Promise<FFmpegPreset[]> => {
  return invoke<FFmpegPreset[]>("delete_preset", { presetId });
};

export const loadQueueState = async (): Promise<QueueState> => {
  return invoke<QueueState>("get_queue_state");
};

export const enqueueTranscodeJob = async (params: {
  filename: string;
  jobType: JobType;
  source: JobSource;
  originalSizeMb: number;
  originalCodec?: string;
  presetId: string;
}): Promise<TranscodeJob> => {
  const { filename, jobType, source, originalSizeMb, originalCodec, presetId } = params;
  return invoke<TranscodeJob>("enqueue_transcode_job", {
    // Accept both camelCase and snake_case keys to align with the Rust command
    filename,
    jobType,
    job_type: jobType,
    source,
    originalSizeMb,
    original_size_mb: originalSizeMb,
    originalCodec,
    original_codec: originalCodec,
    presetId,
    preset_id: presetId,
  });
};

export const cancelTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invoke<boolean>("cancel_transcode_job", {
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
