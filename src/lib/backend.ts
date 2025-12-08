import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import type {
  AppSettings,
  AutoCompressResult,
  CpuUsageSnapshot,
  ExternalToolCandidate,
  ExternalToolKind,
  ExternalToolStatus,
  GpuUsageSnapshot,
  FFmpegPreset,
  JobSource,
  JobType,
  SmartScanConfig,
  QueueState,
  QueueStateLite,
  TranscodeJob,
  SystemMetricsSnapshot,
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

export const metricsSubscribe = async (): Promise<void> => {
  if (!hasTauri()) return;
  await invoke<void>("metrics_subscribe");
};

export const metricsUnsubscribe = async (): Promise<void> => {
  if (!hasTauri()) return;
  await invoke<void>("metrics_unsubscribe");
};

export const fetchMetricsHistory = async (): Promise<SystemMetricsSnapshot[]> => {
  if (!hasTauri()) return [];
  return invoke<SystemMetricsSnapshot[]>("get_metrics_history");
};

export const fetchExternalToolStatuses = async (): Promise<ExternalToolStatus[]> => {
  return invoke<ExternalToolStatus[]>("get_external_tool_statuses");
};

export const fetchExternalToolCandidates = async (
  kind: ExternalToolKind,
): Promise<ExternalToolCandidate[]> => {
  return invoke<ExternalToolCandidate[]>("get_external_tool_candidates", { kind });
};

export const downloadExternalToolNow = async (
  kind: ExternalToolKind,
): Promise<ExternalToolStatus[]> => {
  return invoke<ExternalToolStatus[]>("download_external_tool_now", { kind });
};

export const acknowledgeTaskbarProgress = async (): Promise<void> => {
  // Best-effort; errors are surfaced to the console by the caller.
  await invoke<void>("ack_taskbar_progress");
};

export const openDevtools = async (): Promise<void> => {
  await invoke<void>("open_devtools");
};

export const loadPresets = async (): Promise<FFmpegPreset[]> => {
  return invoke<FFmpegPreset[]>("get_presets");
};

export const loadSmartDefaultPresets = async (): Promise<FFmpegPreset[]> => {
  return invoke<FFmpegPreset[]>("get_smart_default_presets");
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

export const reorderPresetsOnBackend = async (
  orderedIds: string[],
): Promise<FFmpegPreset[]> => {
  // Accept both camelCase and snake_case to stay resilient to Rust-side param names.
  return invoke<FFmpegPreset[]>("reorder_presets", { orderedIds, ordered_ids: orderedIds });
};

export const loadQueueState = async (): Promise<QueueState> => {
  return invoke<QueueState>("get_queue_state");
};

export const loadQueueStateLite = async (): Promise<QueueStateLite> => {
  return invoke<QueueStateLite>("get_queue_state_lite");
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

export const waitTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invoke<boolean>("wait_transcode_job", {
    jobId,
    job_id: jobId,
  });
};

export const resumeTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invoke<boolean>("resume_transcode_job", {
    jobId,
    job_id: jobId,
  });
};

export const restartTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invoke<boolean>("restart_transcode_job", {
    jobId,
    job_id: jobId,
  });
};

export const deleteTranscodeJob = async (jobId: string): Promise<boolean> => {
  return invoke<boolean>("delete_transcode_job", {
    jobId,
    job_id: jobId,
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

export const inspectMedia = async (path: string): Promise<string> => {
  return invoke<string>("inspect_media", {
    path,
  });
};

/**
 * Given an ordered list of candidate media paths (input/output/tmp), ask the
 * backend to pick the first one that currently exists as a regular file.
 *
 * In Tauri mode this uses a dedicated command that checks filesystem state so
 * preview playback can transparently fall back when users delete or replace
 * original/output files. In pure web/test environments we simply return the
 * first non-empty candidate to keep behaviour predictable and cheap.
 */
export const selectPlayableMediaPath = async (
  candidatePaths: string[],
): Promise<string | null> => {
  const filtered = candidatePaths.filter((p) => !!p);
  if (!filtered.length) return null;

  if (!hasTauri()) {
    return filtered[0] ?? null;
  }

  try {
    return await invoke<string | null>("select_playable_media_path", {
      // Accept both camelCase and snake_case to stay resilient to Rust-side renames.
      candidatePaths: filtered,
      candidate_paths: filtered,
    });
  } catch (error) {
    console.error("selectPlayableMediaPath: falling back to first candidate after error", error);
    return filtered[0] ?? null;
  }
};

/**
 * Build a safe local preview URL for images or videos backed by a filesystem
 * path. In Tauri we prefer `convertFileSrc` so the webview can load the file
 * via the asset protocol; in pure web / test environments we fall back to the
 * raw path string.
 */
export const buildPreviewUrl = (path: string | null | undefined): string | null => {
  if (!path) return null;

  if (typeof window === "undefined") {
    // SSR / tests without a DOM: just return the raw path so callers can still
    // render something or assert against the value.
    return path;
  }

  if (!hasTauri() || typeof convertFileSrc !== "function") {
    return path;
  }

  try {
    return convertFileSrc(path);
  } catch (error) {
    console.error("Failed to convert local preview path with convertFileSrc", error);
    return path;
  }
};
