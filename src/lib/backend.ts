import { convertFileSrc } from "@tauri-apps/api/core";
import type {
  AppSettings,
  AutoCompressResult,
  CpuUsageSnapshot,
  ExternalToolCandidate,
  ExternalToolKind,
  ExternalToolStatus,
  GpuUsageSnapshot,
  FFmpegPreset,
  PresetTemplateValidationResult,
  OutputPolicy,
  BatchCompressConfig,
  QueueState,
  QueueStateLite,
  TranscodeJob,
  EnqueueTranscodeJobRequest,
  EnqueueTranscodeJobsRequest,
  SystemMetricsSnapshot,
  TranscodeActivityToday,
} from "../types";
import type { SystemFontFamily } from "./systemFontSearch";
import type { DownloadedFontInfo, OpenSourceFontInfo, UiFontDownloadSnapshot } from "./backend.types";
import { hasTauri } from "./backend.core";
import { invokeCommand } from "./backend/invokeCommand";
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
export {
  cancelTranscodeJob,
  cancelTranscodeJobsBulk,
  waitTranscodeJob,
  waitTranscodeJobsBulk,
  resumeTranscodeJob,
  resumeTranscodeJobsBulk,
  restartTranscodeJob,
  restartTranscodeJobsBulk,
  deleteTranscodeJob,
  deleteTranscodeJobsBulk,
  deleteBatchCompressBatchOnBackend,
  deleteBatchCompressBatchesBulk,
  reorderQueue,
  loadJobDetail,
  loadPreviewDataUrl,
  ensureJobPreview,
  ensureJobPreviewVariant,
  measureJobVmaf,
} from "./backend/queue";
export const loadAppSettings = async (): Promise<AppSettings> => {
  return invokeCommand<AppSettings>("get_app_settings");
};

export const saveAppSettings = async (settings: AppSettings): Promise<AppSettings> => {
  return invokeCommand<AppSettings>("save_app_settings", { settings });
};

export const fetchSystemFontFamilies = async (): Promise<SystemFontFamily[]> => {
  if (!hasTauri()) return [];
  return invokeCommand<SystemFontFamily[]>("get_system_font_families");
};

export const listOpenSourceFonts = async (): Promise<OpenSourceFontInfo[]> => {
  if (!hasTauri()) return [];
  return invokeCommand<OpenSourceFontInfo[]>("list_open_source_fonts");
};

export const startOpenSourceFontDownload = async (fontId: string): Promise<UiFontDownloadSnapshot> => {
  if (!hasTauri()) {
    throw new Error("startOpenSourceFontDownload requires Tauri");
  }
  return invokeCommand<UiFontDownloadSnapshot>("start_open_source_font_download", { fontId });
};

export const fetchOpenSourceFontDownloadSnapshot = async (fontId: string): Promise<UiFontDownloadSnapshot | null> => {
  if (!hasTauri()) return null;
  return invokeCommand<UiFontDownloadSnapshot | null>("get_open_source_font_download_snapshot", { fontId });
};

export const cancelOpenSourceFontDownload = async (fontId: string): Promise<boolean> => {
  if (!hasTauri()) return false;
  return invokeCommand<boolean>("cancel_open_source_font_download", { fontId });
};

export const ensureOpenSourceFontDownloaded = async (fontId: string): Promise<DownloadedFontInfo> => {
  if (!hasTauri()) {
    throw new Error("ensureOpenSourceFontDownloaded requires Tauri");
  }
  return invokeCommand<DownloadedFontInfo>("ensure_open_source_font_downloaded", { fontId });
};

export const importUiFontFile = async (sourcePath: string): Promise<DownloadedFontInfo> => {
  if (!hasTauri()) {
    throw new Error("importUiFontFile requires Tauri");
  }
  const normalized = sourcePath.trim();
  if (!normalized) {
    throw new Error("font file path is empty");
  }
  return invokeCommand<DownloadedFontInfo>("import_ui_font_file", { sourcePath: normalized });
};

export const loadBatchCompressDefaults = async (): Promise<BatchCompressConfig> => {
  return invokeCommand<BatchCompressConfig>("get_batch_compress_defaults");
};

export const saveBatchCompressDefaults = async (config: BatchCompressConfig): Promise<BatchCompressConfig> => {
  return invokeCommand<BatchCompressConfig>("save_batch_compress_defaults", { config });
};

export const runAutoCompress = async (rootPath: string, config: BatchCompressConfig): Promise<AutoCompressResult> => {
  return invokeCommand<AutoCompressResult>("run_auto_compress", { rootPath, config });
};

export const fetchCpuUsage = async (): Promise<CpuUsageSnapshot> => {
  return invokeCommand<CpuUsageSnapshot>("get_cpu_usage");
};

export const fetchGpuUsage = async (): Promise<GpuUsageSnapshot> => {
  return invokeCommand<GpuUsageSnapshot>("get_gpu_usage");
};

export const metricsSubscribe = async (): Promise<void> => {
  if (!hasTauri()) return;
  await invokeCommand<void>("metrics_subscribe");
};

export const metricsUnsubscribe = async (): Promise<void> => {
  if (!hasTauri()) return;
  await invokeCommand<void>("metrics_unsubscribe");
};

export const fetchMetricsHistory = async (): Promise<SystemMetricsSnapshot[]> => {
  if (!hasTauri()) return [];
  return invokeCommand<SystemMetricsSnapshot[]>("get_metrics_history");
};

export const fetchTranscodeActivityToday = async (): Promise<TranscodeActivityToday> => {
  if (!hasTauri()) {
    return { date: "1970-01-01", activeHours: Array.from({ length: 24 }, () => false) };
  }
  return invokeCommand<TranscodeActivityToday>("get_transcode_activity_today");
};

export const fetchExternalToolStatuses = async (): Promise<ExternalToolStatus[]> => {
  return invokeCommand<ExternalToolStatus[]>("get_external_tool_statuses");
};

export const fetchExternalToolStatusesCached = async (): Promise<ExternalToolStatus[]> => {
  return invokeCommand<ExternalToolStatus[]>("get_external_tool_statuses_cached");
};

export const refreshExternalToolStatusesAsync = async (options?: {
  remoteCheck?: boolean;
  manualRemoteCheck?: boolean;
  remoteCheckKind?: ExternalToolKind;
}): Promise<boolean> => {
  const remoteCheck = options?.remoteCheck ?? false;
  const manualRemoteCheck = options?.manualRemoteCheck ?? false;
  const remoteCheckKind = options?.remoteCheckKind;
  return invokeCommand<boolean>("refresh_external_tool_statuses_async", {
    remoteCheck,
    manualRemoteCheck,
    remoteCheckKind,
  });
};

export const fetchExternalToolCandidates = async (kind: ExternalToolKind): Promise<ExternalToolCandidate[]> => {
  return invokeCommand<ExternalToolCandidate[]>("get_external_tool_candidates", { kind });
};

export const downloadExternalToolNow = async (kind: ExternalToolKind): Promise<ExternalToolStatus[]> => {
  return invokeCommand<ExternalToolStatus[]>("download_external_tool_now", { kind });
};

export const acknowledgeTaskbarProgress = async (): Promise<void> => {
  // Best-effort; errors are surfaced to the console by the caller.
  await invokeCommand<void>("ack_taskbar_progress");
};

export const revealPathInFolder = async (path: string): Promise<void> => {
  const normalized = path.trim();
  if (!normalized) return;
  if (!hasTauri()) return;
  await invokeCommand<void>("reveal_path_in_folder", { path: normalized });
};

export const openDevtools = async (): Promise<void> => {
  await invokeCommand<void>("open_devtools");
};

export const loadPresets = async (): Promise<FFmpegPreset[]> => {
  return invokeCommand<FFmpegPreset[]>("get_presets");
};

export const loadSmartDefaultPresets = async (): Promise<FFmpegPreset[]> => {
  return invokeCommand<FFmpegPreset[]>("get_smart_default_presets");
};

export const downloadVmafSampleVideo = async (sampleId: string): Promise<string> => {
  if (!hasTauri()) {
    throw new Error("downloadVmafSampleVideo requires Tauri");
  }
  const normalized = String(sampleId ?? "").trim();
  if (!normalized) {
    throw new Error("sampleId is empty");
  }
  return invokeCommand<string>("download_vmaf_sample_video", { sampleId: normalized });
};

export const measurePresetVmaf = async (
  presetId: string,
  referencePath: string,
  options?: { trimSeconds?: number | null },
): Promise<number> => {
  if (!hasTauri()) {
    throw new Error("measurePresetVmaf requires Tauri");
  }
  const id = String(presetId ?? "").trim();
  if (!id) {
    throw new Error("presetId is empty");
  }
  const ref = String(referencePath ?? "").trim();
  if (!ref) {
    throw new Error("referencePath is empty");
  }
  const trimSecondsRaw = options?.trimSeconds;
  const trimSeconds =
    typeof trimSecondsRaw === "number" && Number.isFinite(trimSecondsRaw) && trimSecondsRaw > 0 ? trimSecondsRaw : null;
  return invokeCommand<number>("measure_preset_vmaf", { presetId: id, referencePath: ref, trimSeconds });
};

export const savePresetOnBackend = async (preset: FFmpegPreset): Promise<FFmpegPreset[]> => {
  return invokeCommand<FFmpegPreset[]>("save_preset", { preset });
};

export const deletePresetOnBackend = async (presetId: string): Promise<FFmpegPreset[]> => {
  return invokeCommand<FFmpegPreset[]>("delete_preset", { presetId });
};

export const reorderPresetsOnBackend = async (orderedIds: string[]): Promise<FFmpegPreset[]> => {
  return invokeCommand<FFmpegPreset[]>("reorder_presets", { orderedIds });
};

export const validatePresetTemplate = async (
  preset: FFmpegPreset,
  options?: { timeoutMs?: number },
): Promise<PresetTemplateValidationResult> => {
  if (!hasTauri()) {
    const template = String(preset.ffmpegTemplate ?? "").trim();
    const url = typeof window === "undefined" ? null : new URL(window.location.href);
    const rawOutcome = url?.searchParams.get("ffuiMockPresetTemplateValidation")?.trim() ?? "";
    const outcome = (() => {
      if (rawOutcome === "failed") return "failed";
      if (rawOutcome === "templateInvalid") return "templateInvalid";
      if (rawOutcome === "timedOut") return "timedOut";
      if (rawOutcome === "skippedToolUnavailable") return "skippedToolUnavailable";
      if (rawOutcome === "ok") return "ok";
      if (template.includes("FFUI_MOCK_TEMPLATE_INVALID")) return "templateInvalid";
      if (template.includes("FFUI_MOCK_TIMED_OUT")) return "timedOut";
      if (template.includes("FFUI_MOCK_TOOL_MISSING")) return "skippedToolUnavailable";
      if (template.includes("FFUI_MOCK_FAILED")) return "failed";
      return "ok";
    })() satisfies PresetTemplateValidationResult["outcome"];

    await new Promise((r) => setTimeout(r, 0));

    if (outcome === "ok") return { outcome };
    if (outcome === "templateInvalid") {
      return {
        outcome,
        message: template ? "mock: template invalid" : "mock: template is empty",
      };
    }
    if (outcome === "timedOut") {
      const timeoutMs = options?.timeoutMs;
      return {
        outcome,
        message: timeoutMs ? `mock: timed out after ${timeoutMs}ms` : "mock: timed out",
      };
    }
    if (outcome === "skippedToolUnavailable") {
      return { outcome, message: "mock: tool unavailable" };
    }
    return { outcome: "failed", exitCode: 1, stderrSummary: "mock: validate_preset_template failed" };
  }

  const timeoutMs = options?.timeoutMs;
  const payload: { preset: FFmpegPreset; timeoutMs?: number } = { preset };
  if (typeof timeoutMs === "number") payload.timeoutMs = timeoutMs;
  return invokeCommand<PresetTemplateValidationResult>("validate_preset_template", payload);
};

export const loadQueueState = async (): Promise<QueueState> => {
  return invokeCommand<QueueState>("get_queue_state");
};

export const loadQueueStateLite = async (): Promise<QueueStateLite> => {
  return invokeCommand<QueueStateLite>("get_queue_state_lite");
};

export const expandManualJobInputs = async (paths: string[], options?: { recursive?: boolean }): Promise<string[]> => {
  if (!hasTauri()) return [];
  const normalized = (paths ?? []).filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  if (normalized.length === 0) return [];

  const recursive = options?.recursive ?? true;
  return invokeCommand<string[]>("expand_manual_job_inputs", {
    paths: normalized,
    recursive,
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
  return invokeCommand<string | null>("preview_output_path", { inputPath, presetId, outputPolicy });
};

export const enqueueTranscodeJob = async (params: EnqueueTranscodeJobRequest): Promise<TranscodeJob> => {
  const { filename, jobType, source, originalSizeMb, originalCodec, presetId } = params;
  return invokeCommand<TranscodeJob>("enqueue_transcode_job", {
    filename,
    jobType,
    source,
    originalSizeMb,
    originalCodec,
    presetId,
  });
};

export const enqueueTranscodeJobs = async (params: EnqueueTranscodeJobsRequest): Promise<TranscodeJob[]> => {
  const { filenames, jobType, source, originalSizeMb, originalCodec, presetId } = params;
  return invokeCommand<TranscodeJob[]>("enqueue_transcode_jobs", {
    filenames,
    jobType,
    source,
    originalSizeMb,
    originalCodec,
    presetId,
  });
};

export type { FallbackFrameQuality } from "./backend/fallbackPreview";
export { cleanupFallbackPreviewFramesAsync, extractFallbackPreviewFrame } from "./backend/fallbackPreview";
export {
  getJobCompareSources,
  extractJobCompareFrame,
  extractJobCompareOutputFrame,
  extractJobCompareConcatFrame,
} from "./backend/jobCompare";
export { cleanupPreviewCachesAsync } from "./backend/previewCache";

export const inspectMedia = async (path: string): Promise<string> => {
  return invokeCommand<string>("inspect_media", {
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
    const selected = await invokeCommand<string | null>("select_playable_media_path", { candidatePaths: filtered });
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
