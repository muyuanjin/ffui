import type {
  AppSettings,
  AutoCompressResult,
  CpuUsageSnapshot,
  ExternalToolCandidate,
  ExternalToolKind,
  ExternalToolStatus,
  FFmpegPreset,
  GpuUsageSnapshot,
  JobCompareSources,
  OutputPolicy,
  QueueStateLite,
  QueueState,
  BatchCompressConfig,
  SystemMetricsSnapshot,
  TranscodeActivityToday,
  TranscodeJob,
} from "@/types";
import { previewOutputPathLocal } from "@/lib/outputPolicyPreview";
import smartPresetsJson from "../../../src-tauri/assets/smart-presets.json";

// The production app talks to a Tauri backend. For docs screenshots we replace
// the backend module at build time (Vite alias) with this in-browser mock so
// we do not need any screenshot-only code inside the app runtime.

const readEnv = (key: string): string | undefined => {
  try {
    const env = (import.meta as any).env ?? {};
    const v = env[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
};

const readEnvNumber = (key: string): number | null => {
  const raw = readEnv(key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const clampInt = (n: number | null, min: number, max: number, fallback: number): number => {
  if (n == null) return fallback;
  const rounded = Math.round(n);
  return Math.min(max, Math.max(min, rounded));
};

const resolveUiScalePercent = (): number => {
  return clampInt(readEnvNumber("VITE_DOCS_SCREENSHOT_UI_SCALE_PERCENT"), 80, 140, 100);
};

const resolveUiFontSizePercent = (): number => {
  const percent = readEnvNumber("VITE_DOCS_SCREENSHOT_UI_FONT_SIZE_PERCENT");
  if (percent != null) return clampInt(percent, 80, 140, 113);

  const px = readEnvNumber("VITE_DOCS_SCREENSHOT_UI_FONT_SIZE_PX");
  if (px != null) {
    const p = Math.round((px / 16) * 100);
    return clampInt(p, 80, 140, 113);
  }

  // 18px option => round(px/16*100) = 113
  return 113;
};

const resolveUiFontName = (): string | null => {
  const v = (readEnv("VITE_DOCS_SCREENSHOT_UI_FONT_NAME") ?? "").trim();
  return v.length > 0 ? v : null;
};

export const hasTauri = () => true;

export const buildPreviewUrl = (path: string | null | undefined): string | null => {
  if (!path) return null;
  return path;
};

// Single abstraction for `<video>/<audio>` URLs (kept in sync with src/lib/backend.ts).
export const buildPlayableMediaUrl = buildPreviewUrl;

export type FallbackFrameQuality = "low" | "high";

const FALLBACK_PREVIEW_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO1W2XwAAAAASUVORK5CYII=";

export const extractFallbackPreviewFrame = async (_args: {
  sourcePath: string;
  positionPercent?: number;
  positionSeconds?: number;
  durationSeconds?: number | null;
  quality: FallbackFrameQuality;
}): Promise<string> => {
  // Return a small data URL so docs screenshot builds can render the UI without
  // depending on real filesystem assets.
  return `data:image/png;base64,${FALLBACK_PREVIEW_PNG_BASE64}`;
};

export const getJobCompareSources = async (jobId: string): Promise<JobCompareSources | null> => {
  const normalized = String(jobId ?? "").trim();
  if (!normalized) return null;

  return {
    jobId: normalized,
    inputPath: "C:/docs-screenshot/input.mp4",
    output: { kind: "completed", outputPath: "C:/docs-screenshot/output.mp4" },
    maxCompareSeconds: 60,
  };
};

export const extractJobCompareFrame = async (_args: {
  jobId: string;
  sourcePath: string;
  positionSeconds: number;
  durationSeconds?: number | null;
  quality: FallbackFrameQuality;
}): Promise<string> => {
  return `data:image/png;base64,${FALLBACK_PREVIEW_PNG_BASE64}`;
};

export const extractJobCompareConcatFrame = async (_args: {
  jobId: string;
  segmentPaths: string[];
  positionSeconds: number;
  quality: FallbackFrameQuality;
}): Promise<string> => {
  return `data:image/png;base64,${FALLBACK_PREVIEW_PNG_BASE64}`;
};

export const cleanupFallbackPreviewFramesAsync = async (): Promise<boolean> => {
  return true;
};

export const cleanupPreviewCachesAsync = async (): Promise<boolean> => {
  return true;
};

export const selectPlayableMediaPath = async (candidates: string[]): Promise<string | null> => {
  const trimmed = (candidates ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
  return trimmed[0] ?? null;
};

let appSettingsSnapshot: AppSettings | null = null;

const makeAppSettings = (): AppSettings => {
  return {
    tools: {
      autoDownload: true,
      autoUpdate: true,
      ffmpegPath: "",
      ffprobePath: "",
      avifencPath: "",
      downloaded: {
        ffmpeg: {
          version: "N-121700-g36e5576a44",
          tag: "docs-screenshot",
          sourceUrl: "https://github.com/BtbN/FFmpeg-Builds/releases",
        },
        ffprobe: {
          version: "N-121700-g36e5576a44",
          tag: "docs-screenshot",
          sourceUrl: "https://github.com/BtbN/FFmpeg-Builds/releases",
        },
        avifenc: {
          version: "1.0.0",
          tag: "docs-screenshot",
          sourceUrl: "https://github.com/AOMediaCodec/libavif",
        },
      },
    },
    batchCompressDefaults: {
      replaceOriginal: true,
      minVideoSizeMB: 200,
      minImageSizeKB: 512,
      minAudioSizeKB: 1024,
      savingConditionType: "ratio",
      minSavingRatio: 0.2,
      minSavingAbsoluteMB: 100,
      imageTargetFormat: "avif",
      videoPresetId: "p1",
      audioPresetId: "p1",
      videoFilter: { enabled: true, extensions: ["mp4", "mkv", "mov", "webm"] },
      imageFilter: { enabled: true, extensions: ["jpg", "jpeg", "png", "webp"] },
      audioFilter: { enabled: false, extensions: ["mp3", "aac", "flac"] },
    } satisfies BatchCompressConfig,
    previewCapturePercent: 25,
    uiScalePercent: resolveUiScalePercent(),
    uiFontSizePercent: resolveUiFontSizePercent(),
    uiFontFamily: "system",
    uiFontName: resolveUiFontName() ?? undefined,
    developerModeEnabled: true,
    progressUpdateIntervalMs: 200,
    metricsIntervalMs: 1000,
    taskbarProgressMode: "byEstimatedTime",
    taskbarProgressScope: "activeAndQueued",
    queuePersistenceMode: "crashRecoveryLite",
    crashRecoveryLogRetention: { maxFiles: 100, maxTotalMb: 1024 },
    onboardingCompleted: true,
    presetSortMode: "manual",
    presetViewMode: "grid",
    selectionBarPinned: false,
  };
};

export const loadAppSettings = async (): Promise<AppSettings> => {
  if (!appSettingsSnapshot) appSettingsSnapshot = makeAppSettings();
  return appSettingsSnapshot;
};

export const saveAppSettings = async (settings: AppSettings): Promise<AppSettings> => {
  appSettingsSnapshot = settings;
  return settings;
};

export const fetchExternalToolStatusesCached = async (): Promise<ExternalToolStatus[]> => {
  const settings = await loadAppSettings();
  const base = {
    updateAvailable: false,
    autoDownloadEnabled: settings.tools.autoDownload,
    autoUpdateEnabled: settings.tools.autoUpdate,
    downloadInProgress: false,
  } as const;

  return [
    {
      kind: "ffmpeg",
      resolvedPath: settings.tools.ffmpegPath || "ffmpeg",
      source: "download",
      version: settings.tools.downloaded?.ffmpeg?.version ?? "N/A",
      ...base,
    },
    {
      kind: "ffprobe",
      resolvedPath: settings.tools.ffprobePath || "ffprobe",
      source: "download",
      version: settings.tools.downloaded?.ffprobe?.version ?? "N/A",
      ...base,
    },
    {
      kind: "avifenc",
      resolvedPath: settings.tools.avifencPath || "avifenc",
      source: "download",
      version: settings.tools.downloaded?.avifenc?.version ?? "N/A",
      ...base,
    },
  ];
};

export const refreshExternalToolStatusesAsync = async (_options?: {
  remoteCheck?: boolean;
  manualRemoteCheck?: boolean;
}): Promise<boolean> => true;

export const fetchExternalToolCandidates = async (_kind: ExternalToolKind): Promise<ExternalToolCandidate[]> => [];

export const downloadExternalToolNow = async (_kind: ExternalToolKind): Promise<ExternalToolStatus[]> => {
  return fetchExternalToolStatusesCached();
};

let presetsSnapshot: FFmpegPreset[] | null = null;

const makePresets = (): FFmpegPreset[] => {
  return [
    {
      id: "p1",
      name: "Universal 1080p",
      description: "x264 Medium CRF 23. Standard for web.",
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
      audio: { codec: "copy" },
      filters: { scale: "-2:1080" },
      stats: { usageCount: 128, totalInputSizeMB: 86_500, totalOutputSizeMB: 42_200, totalTimeSeconds: 5_400 },
    },
    {
      id: "p2",
      name: "Archive Master",
      description: "x264 Slow CRF 18. Near lossless.",
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 18, preset: "slow" },
      audio: { codec: "copy" },
      filters: {},
      stats: { usageCount: 37, totalInputSizeMB: 64_000, totalOutputSizeMB: 52_500, totalTimeSeconds: 9_200 },
    },
    {
      id: "p3",
      name: "AV1 Efficient",
      description: "SVT-AV1 CRF 30. Best size savings.",
      video: { encoder: "libsvtav1", rateControl: "crf", qualityValue: 30, preset: "6" },
      audio: { codec: "copy" },
      filters: { scale: "-2:1080" },
      stats: { usageCount: 22, totalInputSizeMB: 51_200, totalOutputSizeMB: 20_600, totalTimeSeconds: 18_400 },
    },
    {
      id: "p4",
      name: "HEVC Balanced",
      description: "x265 CRF 26. Balanced quality and speed.",
      video: { encoder: "libx265", rateControl: "crf", qualityValue: 26, preset: "medium" },
      audio: { codec: "copy" },
      filters: { scale: "-2:1080" },
      stats: { usageCount: 54, totalInputSizeMB: 73_800, totalOutputSizeMB: 35_900, totalTimeSeconds: 11_200 },
    },
    {
      id: "p5",
      name: "Fast Preview",
      description: "x264 Veryfast CRF 28. Quick iterations.",
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 28, preset: "veryfast" },
      audio: { codec: "aac", bitrate: 192 },
      filters: { scale: "-2:1080" },
      stats: { usageCount: 76, totalInputSizeMB: 18_900, totalOutputSizeMB: 9_400, totalTimeSeconds: 1_250 },
    },
    {
      id: "p6",
      name: "Device Friendly",
      description: "H.264 baseline-ish settings for compatibility.",
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 24, preset: "fast", profile: "baseline" },
      audio: { codec: "aac", bitrate: 160 },
      filters: { scale: "-2:720" },
      stats: { usageCount: 19, totalInputSizeMB: 12_400, totalOutputSizeMB: 7_300, totalTimeSeconds: 980 },
    },
  ];
};

export const loadPresets = async (): Promise<FFmpegPreset[]> => {
  if (!presetsSnapshot) presetsSnapshot = makePresets();
  return presetsSnapshot;
};

export const savePresetOnBackend = async (preset: FFmpegPreset): Promise<FFmpegPreset[]> => {
  const list = await loadPresets();
  const idx = list.findIndex((p) => p.id === preset.id);
  if (idx >= 0) list.splice(idx, 1, preset);
  else list.push(preset);
  return list;
};

export const deletePresetOnBackend = async (presetId: string): Promise<FFmpegPreset[]> => {
  const list = await loadPresets();
  presetsSnapshot = list.filter((p) => p.id !== presetId);
  return presetsSnapshot;
};

export const reorderPresetsOnBackend = async (orderedIds: string[]): Promise<FFmpegPreset[]> => {
  const list = await loadPresets();
  const byId = new Map(list.map((p) => [p.id, p] as const));
  const ordered: FFmpegPreset[] = [];
  for (const id of orderedIds) {
    const p = byId.get(id);
    if (p) ordered.push(p);
  }
  for (const p of list) {
    if (!orderedIds.includes(p.id)) ordered.push(p);
  }
  presetsSnapshot = ordered;
  return ordered;
};

const resolveMediaEnv = (key: string, fallback: string): string => {
  const v = readEnv(key);
  return v ?? fallback;
};

const resolvePosterEnv = (key: string): string | undefined => {
  const v = readEnv(key);
  return v;
};

const readQueryParam = (key: string): string | undefined => {
  try {
    if (typeof window === "undefined") return undefined;
    const raw = window.location?.search ?? "";
    const value = new URLSearchParams(raw).get(key);
    const trimmed = String(value ?? "").trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
};

const buildQueueJobs = (): TranscodeJob[] => {
  const now = 1_700_000_000_000;

  const v1 = resolveMediaEnv("VITE_DOCS_SCREENSHOT_VIDEO_1", "C:/videos/feature_demo_processing.mp4");
  const v2 = resolveMediaEnv("VITE_DOCS_SCREENSHOT_VIDEO_2", "C:/videos/big_buck_bunny_1080p.mp4");
  const v3 = resolveMediaEnv("VITE_DOCS_SCREENSHOT_VIDEO_3", "C:/videos/archive_master_source.mkv");

  const poster1 = resolvePosterEnv("VITE_DOCS_SCREENSHOT_POSTER_1");
  const poster2 = resolvePosterEnv("VITE_DOCS_SCREENSHOT_POSTER_2") ?? poster1;
  const poster3 = resolvePosterEnv("VITE_DOCS_SCREENSHOT_POSTER_3") ?? poster2 ?? poster1;

  const o1 = `${v1}.compressed.mp4`;
  const o2 = `${v2}.compressed.mp4`;
  const o3 = `${v3}.archive.mp4`;

  const queueScenario = readQueryParam("ffuiQueueScenario");
  if (queueScenario === "carousel-3d-many-items") {
    return Array.from({ length: 21 }, (_, idx) => {
      const index = idx + 1;
      const filename = `C:/videos/carousel_many/item_${String(index).padStart(2, "0")}.mp4`;
      const outputPath = `C:/videos/carousel_many/item_${String(index).padStart(2, "0")}.compressed.mp4`;
      const status: TranscodeJob["status"] = index === 1 ? "processing" : index <= 3 ? "queued" : "waiting";
      const progress = status === "processing" ? 42 : 0;
      return {
        id: `docs-carousel-many-${index}`,
        filename,
        type: "video",
        source: "manual",
        originalSizeMB: 280 + index * 12,
        originalCodec: index % 3 === 0 ? "hevc" : "h264",
        presetId: "p1",
        status,
        progress,
        inputPath: filename,
        outputPath,
        previewPath: poster1,
        ffmpegCommand: `ffmpeg -hide_banner -y -i \"${filename}\" -c:v libx264 -preset medium -crf 23 -vf \"scale=-2:1080\" -c:a copy \"${outputPath}\"`,
        logs: [],
        estimatedSeconds: 300,
      } satisfies TranscodeJob;
    });
  }
  if (queueScenario === "taskbar-progress-scope-serial") {
    // Scenario for verifying taskbar/titlebar aggregated progress behaviour:
    // when "active/queued/waiting only" is enabled, completed jobs from the
    // same run should still contribute so progress doesn't reset between
    // serial tasks.
    const cohortStart = now - 120_000;
    return [
      {
        id: "docs-job-completed",
        filename: v3,
        type: "video",
        source: "manual",
        originalSizeMB: 1024,
        originalCodec: "hevc",
        presetId: "p2",
        status: "completed",
        progress: 100,
        startTime: cohortStart,
        processingStartedMs: cohortStart + 10_000,
        endTime: cohortStart + 60_000,
        outputSizeMB: 740,
        inputPath: v3,
        outputPath: o3,
        previewPath: poster3,
        ffmpegCommand: `ffmpeg -hide_banner -y -i \"${v3}\" ... \"${o3}\"`,
        logs: [],
        estimatedSeconds: 600,
      },
      {
        id: "docs-job-processing",
        filename: v1,
        type: "video",
        source: "manual",
        originalSizeMB: 1024,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 10,
        startTime: cohortStart,
        processingStartedMs: cohortStart + 70_000,
        inputPath: v1,
        outputPath: o1,
        previewPath: poster1,
        ffmpegCommand: `ffmpeg -hide_banner -y -i \"${v1}\" ... \"${o1}\"`,
        logs: [],
        estimatedSeconds: 600,
      },
    ];
  }

  return [
    {
      id: "docs-job-completed",
      filename: v3,
      type: "video",
      source: "manual",
      originalSizeMB: 2048,
      originalCodec: "hevc",
      presetId: "p2",
      status: "completed",
      progress: 100,
      startTime: now - 1_200_000,
      processingStartedMs: now - 1_180_000,
      endTime: now - 900_000,
      outputSizeMB: 740,
      inputPath: v3,
      outputPath: o3,
      previewPath: poster3,
      ffmpegCommand: `ffmpeg -hide_banner -y -i \"${v3}\" -c:v libx264 -preset slow -crf 18 -vf \"scale=-2:1080\" -c:a copy \"${o3}\"`,
      logs: [
        "frame=  9012 fps= 78 q=-1.0 size=  740MiB time=00:05:00.00 bitrate=20200.0kbits/s speed=2.6x",
        "video:720MiB audio:0MiB subtitle:0MiB other streams:0MiB global headers:0MiB muxing overhead: 2.345%",
        "Transcode finished successfully",
      ],
      estimatedSeconds: 600,
    },
    {
      id: "docs-job-processing",
      filename: v1,
      type: "video",
      source: "manual",
      originalSizeMB: 1536,
      originalCodec: "h264",
      presetId: "p1",
      status: "processing",
      progress: 37,
      startTime: now - 120_000,
      processingStartedMs: now - 110_000,
      inputPath: v1,
      outputPath: o1,
      previewPath: poster1,
      ffmpegCommand: `ffmpeg -hide_banner -y -i \"${v1}\" -c:v libx264 -preset medium -crf 23 -vf \"scale=-2:1080\" -c:a copy \"${o1}\"`,
      logs: [
        "ffmpeg version N-121700-g36e5576a44",
        `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '${v1}':`,
        "Press [q] to stop, [?] for help",
      ],
      estimatedSeconds: 480,
    },
    {
      id: "docs-job-waiting",
      filename: v2,
      type: "video",
      source: "manual",
      originalSizeMB: 1024,
      originalCodec: "h264",
      presetId: "p1",
      status: "waiting",
      progress: 0,
      inputPath: v2,
      outputPath: o2,
      previewPath: poster2,
      ffmpegCommand: `ffmpeg -hide_banner -y -i \"${v2}\" -c:v libx264 -preset medium -crf 23 -vf \"scale=-2:1080\" -c:a copy \"${o2}\"`,
      logs: [],
      estimatedSeconds: 300,
    },
    // Batch Compress composite batch (used by docs/verification screenshots).
    ...Array.from({ length: 18 }, (_, idx) => {
      const index = idx + 1;
      const filename = `C:/videos/batch_compress_batch/item_${String(index).padStart(2, "0")}.mp4`;
      const outputPath = `C:/videos/batch_compress_batch/item_${String(index).padStart(2, "0")}.compressed.mp4`;
      const status: TranscodeJob["status"] =
        index <= 1 ? "processing" : index <= 3 ? "paused" : index <= 6 ? "waiting" : index <= 8 ? "queued" : "waiting";
      const progress = status === "processing" ? 42 : status === "paused" ? 66 : 0;
      return {
        id: `docs-batch-compress-${index}`,
        filename,
        type: "video",
        source: "batch_compress",
        originalSizeMB: 280 + index * 12,
        originalCodec: index % 3 === 0 ? "hevc" : "h264",
        presetId: "p1",
        status,
        progress,
        inputPath: filename,
        outputPath,
        previewPath: poster1,
        ffmpegCommand: `ffmpeg -hide_banner -y -i \"${filename}\" -c:v libx264 -preset medium -crf 23 -vf \"scale=-2:1080\" -c:a copy \"${outputPath}\"`,
        logs: [],
        estimatedSeconds: 300,
        batchId: "docs-batch-1",
      } satisfies TranscodeJob;
    }),
  ];
};

export const loadQueueStateLite = async (): Promise<QueueStateLite> => {
  return { jobs: buildQueueJobs() };
};

export const loadQueueState = async (): Promise<QueueState> => {
  return { jobs: buildQueueJobs() };
};

export const loadPreviewDataUrl = async (_path: string): Promise<string> => {
  throw new Error("loadPreviewDataUrl is not implemented in docs screenshot mode");
};

export const ensureJobPreview = async (_jobId: string): Promise<string | null> => null;

export const loadJobDetail = async (jobId: string): Promise<TranscodeJob | null> => {
  const state = await loadQueueStateLite();
  const job = state.jobs.find((j) => j.id === jobId);
  return (job as any) ?? null;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0);
};

const inferFilename = (value: string): string => {
  const normalized = String(value ?? "").replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
};

const makeEnqueuedJob = (params: {
  filename: string;
  presetId: string;
  jobType?: string;
  source?: string;
  originalSizeMb?: number;
  originalCodec?: string | undefined;
}): TranscodeJob => {
  const now = Date.now();
  const id = `docs-enqueued-${now}-${Math.random().toString(16).slice(2, 8)}`;
  const filename = params.filename.trim() || "input.mp4";
  const outputPath = `C:/output/${filename.replace(/\.[^/.]+$/, "")}.out.mp4`;
  return {
    id,
    filename,
    type: (params.jobType as any) ?? "video",
    source: (params.source as any) ?? "manual",
    originalSizeMB: params.originalSizeMb ?? 0,
    originalCodec: params.originalCodec,
    presetId: params.presetId,
    status: "waiting",
    progress: 0,
    inputPath: filename,
    outputPath,
    previewPath: undefined,
    ffmpegCommand: `ffmpeg -hide_banner -y -i "${filename}" ... "${outputPath}"`,
    logs: [],
    estimatedSeconds: 60,
  };
};

export const expandManualJobInputs = async (paths: string[], options?: { recursive?: boolean }): Promise<string[]> => {
  const normalized = normalizeStringArray(paths);
  if (normalized.length === 0) return [];
  // In docs screenshot mode we don't touch the filesystem; return the inputs.
  // (The production backend expands folders recursively.)
  if (options?.recursive) return normalized;
  return normalized;
};

export const enqueueTranscodeJob = async (
  paramsOrPath:
    | {
        filename: string;
        jobType: string;
        source: string;
        originalSizeMb: number;
        originalCodec?: string;
        presetId: string;
      }
    | string,
  maybePresetId?: string,
): Promise<TranscodeJob> => {
  if (typeof paramsOrPath === "string") {
    const filename = inferFilename(paramsOrPath);
    const presetId = String(maybePresetId ?? "p1");
    return makeEnqueuedJob({ filename, presetId });
  }

  const presetId = String((paramsOrPath as any)?.presetId ?? "p1");
  const filename = String((paramsOrPath as any)?.filename ?? "");
  return makeEnqueuedJob({
    filename: inferFilename(filename),
    presetId,
    jobType: (paramsOrPath as any)?.jobType,
    source: (paramsOrPath as any)?.source,
    originalSizeMb: Number((paramsOrPath as any)?.originalSizeMb ?? 0) || 0,
    originalCodec: (paramsOrPath as any)?.originalCodec,
  });
};

export const enqueueTranscodeJobs = async (params: {
  filenames: string[];
  jobType: string;
  source: string;
  originalSizeMb: number;
  originalCodec?: string;
  presetId: string;
}): Promise<TranscodeJob[]> => {
  const filenames = normalizeStringArray((params as any)?.filenames ?? (params as any)?.fileNames);
  if (filenames.length === 0) return [];
  const presetId = String((params as any)?.presetId ?? (params as any)?.preset_id ?? "p1");
  return filenames.map((name) =>
    makeEnqueuedJob({
      filename: inferFilename(name),
      presetId,
      jobType: (params as any)?.jobType,
      source: (params as any)?.source,
      originalSizeMb: Number((params as any)?.originalSizeMb ?? 0) || 0,
      originalCodec: (params as any)?.originalCodec,
    }),
  );
};

export const deleteTranscodeJob = async (_jobId: string): Promise<boolean> => true;
export const cancelTranscodeJob = async (_jobId: string): Promise<boolean> => true;
export const waitTranscodeJob = async (_jobId: string): Promise<boolean> => true;
export const resumeTranscodeJob = async (_jobId: string): Promise<boolean> => true;
export const restartTranscodeJob = async (_jobId: string): Promise<boolean> => true;

export const reorderQueue = async (_orderedJobIds: string[]): Promise<boolean> => true;

export const deleteBatchCompressBatchOnBackend = async (_batchId: string): Promise<boolean> => true;

export const previewOutputPath = async (params: {
  inputPath: string;
  presetId?: string | null;
  outputPolicy: OutputPolicy;
}): Promise<string | null> => {
  const inputPath = String(params?.inputPath ?? "").trim();
  if (!inputPath) return null;
  const policy = params?.outputPolicy;
  if (!policy) return null;
  return previewOutputPathLocal(inputPath, policy);
};

export const revealPathInFolder = async (_path: string): Promise<boolean> => true;

export const openDevtools = async (): Promise<boolean> => true;

export const acknowledgeTaskbarProgress = async (): Promise<boolean> => true;

export const fetchCpuUsage = async (): Promise<CpuUsageSnapshot> => {
  return { overall: 35, perCore: [22, 40, 33, 28, 45, 19, 37, 41] };
};

export const fetchGpuUsage = async (): Promise<GpuUsageSnapshot> => {
  return { available: true, gpuPercent: 24, memoryPercent: 80 };
};

export const metricsSubscribe = async (): Promise<void> => {};
export const metricsUnsubscribe = async (): Promise<void> => {};

export const fetchMetricsHistory = async (): Promise<SystemMetricsSnapshot[]> => {
  const now = Date.now();
  const result: SystemMetricsSnapshot[] = [];
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const mbpsToBps = (mbps: number) => Math.round(mbps * 1024 * 1024);
  const TWO_PI = Math.PI * 2;

  // Seed a deterministic-but-lively history so charts have visible variation
  // immediately (no empty/flat lines, no zero heatmap).
  const samples = 80;
  const stepMs = 500;

  for (let i = 0; i < samples; i += 1) {
    const t = now - (samples - i) * stepMs;
    const phaseA = (i / 18) * TWO_PI;
    const phaseB = (i / 11) * TWO_PI;
    const spike = i % 23 === 0 ? 22 : 0;

    const cpuTotal = clamp(35 + 18 * Math.sin(phaseA) + 8 * Math.sin(phaseB) + spike, 3, 98);
    const cores = Array.from({ length: 8 }, (_, idx) => {
      const corePhase = (i / (6 + idx)) * TWO_PI + idx * 0.65;
      const coreSpike = (i + idx * 3) % 29 === 0 ? 18 : 0;
      const v = cpuTotal + (idx - 3.5) * 2 + 10 * Math.sin(corePhase) + coreSpike;
      return clamp(v, 1, 100);
    });

    const memBase = 9.6 * 1024 * 1024 * 1024;
    const memSwing = 2.2 * 1024 * 1024 * 1024;
    const usedBytes = Math.round(memBase + memSwing * (0.5 + 0.5 * Math.sin((i / 33) * TWO_PI)));

    const diskRead = 18 + 10 * Math.abs(Math.sin(phaseA)) + (i % 17 === 0 ? 25 : 0);
    const diskWrite = 6 + 6 * Math.abs(Math.cos(phaseB)) + (i % 19 === 0 ? 14 : 0);

    const netRx = 22 + 14 * Math.abs(Math.sin((i / 9) * TWO_PI)) + (i % 21 === 0 ? 30 : 0);
    const netTx = 5 + 7 * Math.abs(Math.cos((i / 13) * TWO_PI)) + (i % 27 === 0 ? 12 : 0);

    const gpuUsage = clamp(28 + 26 * Math.sin((i / 20) * TWO_PI) + (i % 31 === 0 ? 20 : 0), 0, 100);
    const gpuMem = clamp(52 + 22 * Math.sin((i / 26) * TWO_PI + 0.8), 0, 100);

    result.push({
      timestamp: t,
      uptimeSeconds: 123456,
      cpu: { total: cpuTotal, cores },
      memory: { usedBytes, totalBytes: 16_000_000_000 },
      disk: { io: [{ device: "C:", readBps: mbpsToBps(diskRead), writeBps: mbpsToBps(diskWrite) }] },
      network: { interfaces: [{ name: "Ethernet", rxBps: mbpsToBps(netRx), txBps: mbpsToBps(netTx) }] },
      gpu: { available: true, gpuPercent: gpuUsage, memoryPercent: gpuMem },
    });
  }
  return result;
};

export const loadBatchCompressDefaults = async (): Promise<BatchCompressConfig> => {
  const settings = await loadAppSettings();
  return settings.batchCompressDefaults;
};

export const saveBatchCompressDefaults = async (config: BatchCompressConfig): Promise<BatchCompressConfig> => {
  const settings = await loadAppSettings();
  appSettingsSnapshot = { ...settings, batchCompressDefaults: config };
  return config;
};

export const fetchExternalToolStatuses = async (): Promise<ExternalToolStatus[]> => {
  return fetchExternalToolStatusesCached();
};

export const ensureOpenSourceFontDownloaded = async (_fontId: string): Promise<DownloadedFontInfo> => {
  return {
    id: "docs-font",
    familyName: "FFUI Docs Font",
    path: "C:/Windows/Fonts/ffui-docs-font.ttf",
    format: "ttf",
  } satisfies DownloadedFontInfo;
};

export const fetchTranscodeActivityToday = async (): Promise<TranscodeActivityToday> => {
  const activeHours = Array.from({ length: 24 }, (_, i) => i >= 18 && i <= 23);
  return { date: "2025-01-01", activeHours };
};

export const inspectMedia = async (_path: string): Promise<any> => {
  return {
    format: { filename: _path, format_name: "matroska,webm", duration: "3012.12" },
    streams: [],
  };
};

export const runAutoCompress = async (_rootPath: string, _config: BatchCompressConfig): Promise<AutoCompressResult> => {
  const startedAtMs = Date.now();
  const completedAtMs = startedAtMs + 5000;
  return {
    rootPath: _rootPath,
    jobs: buildQueueJobs(),
    totalFilesScanned: 1234,
    totalCandidates: 42,
    totalProcessed: 42,
    batchId: "docs-batch-1",
    startedAtMs,
    completedAtMs,
  };
};

export const fetchAppUpdaterCapabilities = async (): Promise<{ configured: boolean }> => {
  return { configured: false };
};

export const prepareAppUpdaterProxy = async (): Promise<string | null> => {
  return null;
};

export interface OpenSourceFontInfo {
  id: string;
  name: string;
  familyName: string;
  format: string;
}

export interface DownloadedFontInfo {
  id: string;
  familyName: string;
  path: string;
  format: string;
}

export type UiFontDownloadStatus = "starting" | "downloading" | "ready" | "error" | "canceled";

export interface UiFontDownloadSnapshot {
  sessionId: number;
  fontId: string;
  status: UiFontDownloadStatus;
  receivedBytes: number;
  totalBytes: number | null;
  familyName: string;
  format: string;
  path: string | null;
  error: string | null;
}

export const fetchSystemFontFamilies = async (): Promise<string[]> => {
  return ["Segoe UI", "Arial", "Noto Sans", "Consolas", "Microsoft YaHei"];
};

export const listOpenSourceFonts = async (): Promise<OpenSourceFontInfo[]> => {
  return [
    { id: "inter", name: "Inter", familyName: "Inter", format: "ttf" },
    { id: "jetbrains-mono", name: "JetBrains Mono", familyName: "JetBrains Mono", format: "ttf" },
  ];
};

export const startOpenSourceFontDownload = async (fontId: string): Promise<UiFontDownloadSnapshot> => {
  return {
    sessionId: 1,
    fontId,
    status: "ready",
    receivedBytes: 1024,
    totalBytes: 1024,
    familyName: "Inter",
    format: "ttf",
    path: "C:/fake/fonts/inter.ttf",
    error: null,
  };
};

export const fetchOpenSourceFontDownloadSnapshot = async (fontId: string): Promise<UiFontDownloadSnapshot | null> => {
  return {
    sessionId: 1,
    fontId,
    status: "ready",
    receivedBytes: 1024,
    totalBytes: 1024,
    familyName: "Inter",
    format: "ttf",
    path: "C:/fake/fonts/inter.ttf",
    error: null,
  };
};

export const cancelOpenSourceFontDownload = async (_fontId: string): Promise<boolean> => true;

export const importUiFontFile = async (_sourcePath: string): Promise<DownloadedFontInfo> => {
  return {
    id: "imported",
    familyName: "FFUI Imported",
    path: _sourcePath,
    format: "ttf",
  };
};

type SmartPresetEnv = {
  gpuAvailable: boolean;
  gpuVendor?: string | null;
};

type SmartPresetMatchCriteria = {
  gpu?: {
    available?: boolean;
    vendor?: string;
  };
};

type SmartPresetRecord = {
  id: string;
  name: string;
  description?: string;
  descriptionI18n?: Record<string, string>;
  global?: unknown | null;
  input?: unknown | null;
  mapping?: unknown | null;
  video: FFmpegPreset["video"];
  audio: FFmpegPreset["audio"];
  filters?: FFmpegPreset["filters"] | null;
  subtitles?: FFmpegPreset["subtitles"] | null;
  container?: FFmpegPreset["container"] | null;
  hardware?: FFmpegPreset["hardware"] | null;
  advancedEnabled?: boolean | null;
  ffmpegTemplate?: string | null;
  match?: SmartPresetMatchCriteria;
  priority?: number;
  expose?: boolean;
};

const matchSmartPreset = (record: SmartPresetRecord, env: SmartPresetEnv): boolean => {
  if (record.expose === false) return false;
  const gpu = record.match?.gpu;
  if (gpu) {
    if (typeof gpu.available === "boolean" && gpu.available !== env.gpuAvailable) return false;
    if (typeof gpu.vendor === "string") {
      const expected = String(env.gpuVendor ?? "").toLowerCase();
      if (expected && gpu.vendor.toLowerCase() !== expected) return false;
    }
  }
  return true;
};

const coerceNullable = <T>(value: T | null | undefined): T | undefined => {
  if (value == null) return undefined;
  return value;
};

const toSmartDefaultPreset = (record: SmartPresetRecord): FFmpegPreset => {
  return {
    id: String(record.id),
    name: String(record.name),
    description: String(record.description ?? ""),
    descriptionI18n: record.descriptionI18n,
    global: coerceNullable(record.global as FFmpegPreset["global"] | null | undefined),
    input: coerceNullable(record.input as FFmpegPreset["input"] | null | undefined),
    mapping: coerceNullable(record.mapping as FFmpegPreset["mapping"] | null | undefined),
    video: record.video,
    audio: record.audio,
    filters: record.filters ?? {},
    subtitles: coerceNullable(record.subtitles),
    container: coerceNullable(record.container),
    hardware: coerceNullable(record.hardware),
    advancedEnabled: record.advancedEnabled ?? false,
    ffmpegTemplate: coerceNullable(record.ffmpegTemplate),
    stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
  };
};

let smartDefaultPresetsSnapshot: FFmpegPreset[] | null = null;

export const loadSmartDefaultPresets = async (): Promise<FFmpegPreset[]> => {
  if (smartDefaultPresetsSnapshot) return smartDefaultPresetsSnapshot;

  const file = smartPresetsJson as unknown as { presets?: SmartPresetRecord[] };
  const records = Array.isArray(file?.presets) ? file.presets : [];

  // For docs screenshots we intentionally pick the NVIDIA path so the wizard
  // UI can demonstrate GPU-aware recommendations.
  const env: SmartPresetEnv = { gpuAvailable: true, gpuVendor: "nvidia" };

  const candidates = records.filter((record) => matchSmartPreset(record, env));
  candidates.sort((a, b) => {
    const pa = Number.isFinite(a.priority) ? Number(a.priority) : 0;
    const pb = Number.isFinite(b.priority) ? Number(b.priority) : 0;
    return pb - pa || String(a.name).localeCompare(String(b.name));
  });

  const byId = new Map<string, SmartPresetRecord>();
  for (const record of candidates) {
    if (!byId.has(record.id)) byId.set(record.id, record);
  }

  smartDefaultPresetsSnapshot = Array.from(byId.values()).map(toSmartDefaultPreset);
  return smartDefaultPresetsSnapshot;
};
