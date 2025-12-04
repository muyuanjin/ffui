export type EncoderType = "libx264" | "hevc_nvenc" | "libsvtav1" | "copy";
export type AudioCodecType = "copy" | "aac";
export type RateControlMode = "crf" | "cq" | "cbr" | "vbr";

export interface VideoConfig {
  encoder: EncoderType;
  rateControl: RateControlMode;
  qualityValue: number;
  preset: string;
  tune?: string;
  profile?: string;
  /** Target video bitrate in kbps when using CBR/VBR/two-pass modes. */
  bitrateKbps?: number;
  /** Optional max video bitrate in kbps for capped VBR workflows. */
  maxBitrateKbps?: number;
  /** Optional buffer size in kbits used for VBV (`-bufsize`). */
  bufferSizeKbits?: number;
  /**
   * Two-pass encoding flag: 1 or 2 when using `-pass`, undefined for single-pass.
   * The UI should ensure this only appears together with bitrate-based modes.
   */
  pass?: 1 | 2;
}

export interface AudioConfig {
  codec: AudioCodecType;
  bitrate?: number;
}

export interface FilterConfig {
  scale?: string;
  crop?: string;
  fps?: number;
}

export interface PresetStats {
  usageCount: number;
  totalInputSizeMB: number;
  totalOutputSizeMB: number;
  totalTimeSeconds: number;
}

export interface FFmpegPreset {
  id: string;
  name: string;
  description: string;
  video: VideoConfig;
  audio: AudioConfig;
  filters: FilterConfig;
  stats: PresetStats;
  /** When true, use the raw ffmpegTemplate field instead of generated args */
  advancedEnabled?: boolean;
  /** Full ffmpeg command template, e.g. `ffmpeg -i INPUT -c:v libx264 ... OUTPUT` */
  ffmpegTemplate?: string;
}

export type JobStatus =
  | "waiting"
  | "queued"
  | "processing"
  | "paused"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";
export type JobType = "video" | "image";
export type JobSource = "manual" | "smart_scan";

/**
 * Queue view modes used by the queue UI. Additional modes (icon views,
 * dynamic cards, etc.) can be added in future changes while keeping the
 * enum stable for persisted preferences.
 */
export type QueueViewMode =
  | "compact"
  | "detail"
  | "icon-small"
  | "icon-medium"
  | "icon-large"
  | "dynamic-card";

/**
 * Queue interaction modes:
 * - display: purely visual sorting/filtering, never changes execution order.
 * - queue: visual order reflects execution order and allows priority changes.
 */
export type QueueMode = "display" | "queue";

/**
 * Visual styles for per-job progress. Not all styles need to be implemented
 * at once; the enum is forward-compatible so persisted values stay valid.
 */
export type QueueProgressStyle = "bar" | "card-fill" | "ripple-card";

export interface MediaInfo {
  durationSeconds?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  videoCodec?: string;
  audioCodec?: string;
  sizeMB?: number;
}

export interface WaitMetadata {
  /** Last known overall progress percentage when the job was paused via wait. */
  lastProgressPercent?: number;
  /** Approximate number of seconds already processed when the job was paused. */
  processedSeconds?: number;
  /** Path to a partial or temporary output file captured during processing. */
  tmpOutputPath?: string;
}

export interface TranscodeJob {
  id: string;
  filename: string;
  type: JobType;
  source: JobSource;
  /**
   * Stable execution priority within the waiting queue. Lower values are
   * scheduled earlier. In display-only mode this is treated as metadata;
   * in queue mode it is used to reflect backend execution order.
   */
  queueOrder?: number;
  originalSizeMB: number;
  originalCodec?: string;
  presetId: string;
  status: JobStatus;
  progress: number;
  startTime?: number;
  endTime?: number;
  outputSizeMB?: number;
  logs: string[];
  skipReason?: string;
  /** Absolute input path for this job when known (Tauri only). */
  inputPath?: string;
  /** Planned or final output path for this job (e.g. .compressed.mp4). */
  outputPath?: string;
  /** Human-readable ffmpeg command used for this job. */
  ffmpegCommand?: string;
  /** Compact media metadata for the job's input file. */
  mediaInfo?: MediaInfo;
  /** Optional estimated processing time in seconds for this job, used for aggregated progress weighting. */
  estimatedSeconds?: number;
  /** Optional thumbnail path for this job's input media. */
  previewPath?: string;
  /** Optional pre-truncated tail string of logs from the backend. The detail view prefers the full in-memory logs when available and falls back to this tail for legacy snapshots. */
  logTail?: string;
  /** Short structured description of why the job failed. */
  failureReason?: string;
  /** Optional stable id for the Smart Scan batch this job belongs to. */
  batchId?: string;
  /** Optional metadata captured when a job is paused via wait or restored after crash recovery. */
  waitMetadata?: WaitMetadata;
}

export interface SmartScanConfig {
  minImageSizeKB: number;
  minVideoSizeMB: number;
  minSavingRatio: number;
  imageTargetFormat: "avif" | "webp";
  videoPresetId: string;
}

export interface DownloadedToolInfo {
  /** Human-readable version string for the downloaded tool, e.g. "6.0". */
  version?: string;
  /** Optional tag or build identifier, e.g. "b6.0" for ffmpeg-static. */
  tag?: string;
  /** Source URL used to download this binary. */
  sourceUrl?: string;
  /** Unix epoch timestamp in milliseconds when the download completed. */
  downloadedAt?: number;
}

export interface DownloadedToolState {
  ffmpeg?: DownloadedToolInfo;
  ffprobe?: DownloadedToolInfo;
  avifenc?: DownloadedToolInfo;
}

export type TaskbarProgressMode = "bySize" | "byDuration" | "byEstimatedTime";

export interface ExternalToolSettings {
  ffmpegPath?: string;
  ffprobePath?: string;
  avifencPath?: string;
  autoDownload: boolean;
  autoUpdate: boolean;
  /** Optional metadata about binaries that were auto-downloaded by the app. */
  downloaded?: DownloadedToolState;
}

export interface AppSettings {
  tools: ExternalToolSettings;
  smartScanDefaults: SmartScanConfig;
  /** Global preview capture position as a percentage of video duration (0-100). */
  previewCapturePercent: number;
  /** Optional default preset id used for manual queue jobs. */
  defaultQueuePresetId?: string;
  /** Optional upper bound for concurrent ffmpeg jobs; 0 or undefined means auto. */
  maxParallelJobs?: number;
  /** Optional interval in milliseconds between backend progress updates for ffmpeg jobs (bundled binary only). */
  progressUpdateIntervalMs?: number;
  /** Aggregation mode for computing Windows taskbar progress from the queue. */
  taskbarProgressMode?: TaskbarProgressMode;
}

export type ExternalToolKind = "ffmpeg" | "ffprobe" | "avifenc";

export interface ExternalToolStatus {
  kind: ExternalToolKind;
  resolvedPath?: string;
  source?: string;
  version?: string;
  updateAvailable: boolean;
  autoDownloadEnabled: boolean;
  autoUpdateEnabled: boolean;
   /** True when the backend is currently auto-downloading this tool. */
   downloadInProgress: boolean;
   /** Optional percentage progress (0-100); when undefined, treat as indeterminate spinner. */
   downloadProgress?: number;
   /** Last error message emitted while trying to download or update this tool. */
   lastDownloadError?: string;
   /** Last informational message about download/update activity for this tool. */
   lastDownloadMessage?: string;
}

export interface CpuUsageSnapshot {
  overall: number;
  perCore: number[];
}

export interface GpuUsageSnapshot {
  available: boolean;
  gpuPercent?: number;
  memoryPercent?: number;
  error?: string;
}

export interface AutoCompressResult {
  rootPath: string;
  jobs: TranscodeJob[];
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  batchId: string;
  startedAtMs: number;
  completedAtMs: number;
}

export interface AutoCompressProgress {
  rootPath: string;
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  batchId: string;
}

export interface QueueState {
  jobs: TranscodeJob[];
}

/**
 * Frontend-side aggregation of a Smart Scan batch. A single batch can contain
 * many TranscodeJob entries that share the same batchId; this type represents
 * the composite view rendered in the queue (list/grid/icon views).
 */
export interface CompositeSmartScanTask {
  batchId: string;
  rootPath: string;
  jobs: TranscodeJob[];
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  startedAtMs?: number;
  completedAtMs?: number;
  /** Aggregated overall progress for the batch in [0, 100]. */
  overallProgress: number;
  /** Latest active job in this batch, if any. */
  currentJob: TranscodeJob | null;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  cancelledCount: number;
  totalCount: number;
}
