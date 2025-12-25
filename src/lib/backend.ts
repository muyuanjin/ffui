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
  OutputPolicy,
  BatchCompressConfig,
  QueueState,
  QueueStateLite,
  TranscodeJob,
  SystemMetricsSnapshot,
  TranscodeActivityToday,
} from "../types";
import type { SystemFontFamily } from "./systemFontSearch";
import type { DownloadedFontInfo, OpenSourceFontInfo, UiFontDownloadSnapshot } from "./backend.types";
import { hasTauri } from "./backend.core";
import { normalizeQueueStateLiteWaitMetadata } from "./backend.queue-state-lite-normalize";
import { appendQueryParam } from "./url";
export type {
  AppUpdaterCapabilities,
  DownloadedFontInfo,
  OpenSourceFontInfo,
  UiFontDownloadStatus,
  UiFontDownloadSnapshot,
} from "./backend.types";
export { hasTauri } from "./backend.core";
export {
  acknowledgeDataRootFallbackNotice,
  clearAllAppData,
  exportConfigBundle,
  fetchDataRootInfo,
  importConfigBundle,
  openDataRootDir,
  setDataRootMode,
} from "./backend.data-root";
export { fetchAppUpdaterCapabilities, prepareAppUpdaterProxy } from "./backend.updater";
export { exportPresetsBundle, readPresetsBundle } from "./backend.presets-bundle";
export { exitAppNow, exitAppWithAutoWait, resetExitPrompt } from "./backend.app-exit";
export const loadAppSettings = async (): Promise<AppSettings> => {
  return invoke<AppSettings>("get_app_settings");
};

export const saveAppSettings = async (settings: AppSettings): Promise<AppSettings> => {
  return invoke<AppSettings>("save_app_settings", { settings });
};

export const fetchSystemFontFamilies = async (): Promise<SystemFontFamily[]> => {
  if (!hasTauri()) return [];
  return invoke<SystemFontFamily[]>("get_system_font_families");
};

export const listOpenSourceFonts = async (): Promise<OpenSourceFontInfo[]> => {
  if (!hasTauri()) return [];
  return invoke<OpenSourceFontInfo[]>("list_open_source_fonts");
};

export const startOpenSourceFontDownload = async (fontId: string): Promise<UiFontDownloadSnapshot> => {
  if (!hasTauri()) {
    throw new Error("startOpenSourceFontDownload requires Tauri");
  }
  return invoke<UiFontDownloadSnapshot>("start_open_source_font_download", {
    fontId,
    font_id: fontId,
  });
};

export const fetchOpenSourceFontDownloadSnapshot = async (fontId: string): Promise<UiFontDownloadSnapshot | null> => {
  if (!hasTauri()) return null;
  return invoke<UiFontDownloadSnapshot | null>("get_open_source_font_download_snapshot", {
    fontId,
    font_id: fontId,
  });
};

export const cancelOpenSourceFontDownload = async (fontId: string): Promise<boolean> => {
  if (!hasTauri()) return false;
  return invoke<boolean>("cancel_open_source_font_download", {
    fontId,
    font_id: fontId,
  });
};

export const ensureOpenSourceFontDownloaded = async (fontId: string): Promise<DownloadedFontInfo> => {
  if (!hasTauri()) {
    throw new Error("ensureOpenSourceFontDownloaded requires Tauri");
  }
  return invoke<DownloadedFontInfo>("ensure_open_source_font_downloaded", {
    fontId,
    font_id: fontId,
  });
};

export const importUiFontFile = async (sourcePath: string): Promise<DownloadedFontInfo> => {
  if (!hasTauri()) {
    throw new Error("importUiFontFile requires Tauri");
  }
  const normalized = sourcePath.trim();
  if (!normalized) {
    throw new Error("font file path is empty");
  }
  return invoke<DownloadedFontInfo>("import_ui_font_file", {
    sourcePath: normalized,
    source_path: normalized,
  });
};

export const loadBatchCompressDefaults = async (): Promise<BatchCompressConfig> => {
  return invoke<BatchCompressConfig>("get_batch_compress_defaults");
};

export const saveBatchCompressDefaults = async (config: BatchCompressConfig): Promise<BatchCompressConfig> => {
  return invoke<BatchCompressConfig>("save_batch_compress_defaults", { config });
};

export const runAutoCompress = async (rootPath: string, config: BatchCompressConfig): Promise<AutoCompressResult> => {
  return invoke<AutoCompressResult>("run_auto_compress", {
    rootPath,
    root_path: rootPath,
    config,
  });
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

export const fetchTranscodeActivityToday = async (): Promise<TranscodeActivityToday> => {
  if (!hasTauri()) {
    return { date: "1970-01-01", activeHours: Array.from({ length: 24 }, () => false) };
  }
  return invoke<TranscodeActivityToday>("get_transcode_activity_today");
};

export const fetchExternalToolStatuses = async (): Promise<ExternalToolStatus[]> => {
  return invoke<ExternalToolStatus[]>("get_external_tool_statuses");
};

export const fetchExternalToolStatusesCached = async (): Promise<ExternalToolStatus[]> => {
  return invoke<ExternalToolStatus[]>("get_external_tool_statuses_cached");
};

export const refreshExternalToolStatusesAsync = async (options?: {
  remoteCheck?: boolean;
  manualRemoteCheck?: boolean;
  remoteCheckKind?: ExternalToolKind;
}): Promise<boolean> => {
  const remoteCheck = options?.remoteCheck ?? false;
  const manualRemoteCheck = options?.manualRemoteCheck ?? false;
  const remoteCheckKind = options?.remoteCheckKind;
  return invoke<boolean>("refresh_external_tool_statuses_async", {
    remoteCheck,
    remote_check: remoteCheck,
    manualRemoteCheck,
    manual_remote_check: manualRemoteCheck,
    remoteCheckKind,
    remote_check_kind: remoteCheckKind,
  });
};

export const fetchExternalToolCandidates = async (kind: ExternalToolKind): Promise<ExternalToolCandidate[]> => {
  return invoke<ExternalToolCandidate[]>("get_external_tool_candidates", { kind });
};

export const downloadExternalToolNow = async (kind: ExternalToolKind): Promise<ExternalToolStatus[]> => {
  return invoke<ExternalToolStatus[]>("download_external_tool_now", { kind });
};

export const acknowledgeTaskbarProgress = async (): Promise<void> => {
  // Best-effort; errors are surfaced to the console by the caller.
  await invoke<void>("ack_taskbar_progress");
};

export const revealPathInFolder = async (path: string): Promise<void> => {
  const normalized = path.trim();
  if (!normalized) return;
  if (!hasTauri()) return;
  await invoke<void>("reveal_path_in_folder", { path: normalized });
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

export const savePresetOnBackend = async (preset: FFmpegPreset): Promise<FFmpegPreset[]> => {
  return invoke<FFmpegPreset[]>("save_preset", { preset });
};

export const deletePresetOnBackend = async (presetId: string): Promise<FFmpegPreset[]> => {
  return invoke<FFmpegPreset[]>("delete_preset", { presetId, preset_id: presetId });
};

export const reorderPresetsOnBackend = async (orderedIds: string[]): Promise<FFmpegPreset[]> => {
  // Accept both camelCase and snake_case to stay resilient to Rust-side param names.
  return invoke<FFmpegPreset[]>("reorder_presets", { orderedIds, ordered_ids: orderedIds });
};

export const loadQueueState = async (): Promise<QueueState> => {
  return invoke<QueueState>("get_queue_state");
};

export const loadQueueStateLite = async (): Promise<QueueStateLite> => {
  const state = await invoke<QueueStateLite>("get_queue_state_lite");
  return normalizeQueueStateLiteWaitMetadata(state);
};

export const expandManualJobInputs = async (paths: string[], options?: { recursive?: boolean }): Promise<string[]> => {
  if (!hasTauri()) return [];
  const normalized = (paths ?? []).filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  if (normalized.length === 0) return [];

  const recursive = options?.recursive ?? true;
  return invoke<string[]>("expand_manual_job_inputs", {
    paths: normalized,
    recursive,
    // Resilience to backend param naming changes.
    inputPaths: normalized,
    input_paths: normalized,
  });
};

export const previewOutputPath = async (params: {
  inputPath: string;
  presetId?: string | null;
  outputPolicy: OutputPolicy;
}): Promise<string | null> => {
  if (!hasTauri()) return null;
  const inputPath = params.inputPath;
  const presetId = params.presetId ?? null;
  const outputPolicy = params.outputPolicy;
  return invoke<string | null>("preview_output_path", {
    inputPath,
    input_path: inputPath,
    presetId,
    preset_id: presetId,
    outputPolicy,
    output_policy: outputPolicy,
  });
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

export const enqueueTranscodeJobs = async (params: {
  filenames: string[];
  jobType: JobType;
  source: JobSource;
  originalSizeMb: number;
  originalCodec?: string;
  presetId: string;
}): Promise<TranscodeJob[]> => {
  const { filenames, jobType, source, originalSizeMb, originalCodec, presetId } = params;
  return invoke<TranscodeJob[]>("enqueue_transcode_jobs", {
    // Accept both camelCase and snake_case keys to align with the Rust command
    filenames,
    fileNames: filenames,
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

export const deleteBatchCompressBatchOnBackend = async (batchId: string): Promise<boolean> => {
  return invoke<boolean>("delete_batch_compress_batch", {
    // 同时传递 camelCase 与 snake_case，避免后端参数名调整导致调用失效。
    batchId,
    batch_id: batchId,
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

export type { FallbackFrameQuality } from "./backend/fallbackPreview";
export { cleanupFallbackPreviewFramesAsync, extractFallbackPreviewFrame } from "./backend/fallbackPreview";
export { getJobCompareSources, extractJobCompareFrame, extractJobCompareConcatFrame } from "./backend/jobCompare";
export { cleanupPreviewCachesAsync } from "./backend/previewCache";

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
export const selectPlayableMediaPath = async (candidatePaths: string[]): Promise<string | null> => {
  const filtered = candidatePaths.filter((p) => !!p);
  if (!filtered.length) return null;

  if (!hasTauri()) {
    return filtered[0] ?? null;
  }

  try {
    const selected = await invoke<string | null>("select_playable_media_path", {
      // Accept both camelCase and snake_case to stay resilient to Rust-side renames.
      candidatePaths: filtered,
      candidate_paths: filtered,
    });

    // 后端可能因为路径过长/权限问题返回 null，这里回退到首个候选，避免上层拿到空值后出现“无可播放视频”。
    return selected ?? filtered[0] ?? null;
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

/**
 * Build a preview URL for a job thumbnail, including a cache-busting query when
 * a monotonic `previewRevision` is provided by the backend.
 *
 * The revision is only applied in Tauri mode (where the preview URL is backed
 * by a stable local asset URL); in pure web mode we return the base URL to
 * avoid turning filesystem-looking paths into invalid URLs.
 */
export const buildJobPreviewUrl = (
  previewPath: string | null | undefined,
  previewRevision?: number | null,
): string | null => {
  const url = buildPreviewUrl(previewPath);
  if (!url) return null;
  if (!hasTauri()) return url;
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;

  const revision = Number(previewRevision ?? 0);
  if (!Number.isFinite(revision) || revision <= 0) return url;

  return appendQueryParam(url, "ffuiPreviewRev", String(Math.floor(revision)));
};

// Single abstraction for `<video>/<audio>` URLs (may switch to secure scheme later).
export const buildPlayableMediaUrl = buildPreviewUrl;
