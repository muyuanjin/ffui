export type EncoderType = "libx264" | "hevc_nvenc" | "libsvtav1" | "copy";
export type AudioCodecType = "copy" | "aac";
export type RateControlMode = "crf" | "cq" | "cbr" | "vbr";
export type AudioLoudnessProfile = "none" | "cnBroadcast" | "ebuR128";

// ----- Global / input / mapping / container / hardware parameter groups -----

export type OverwriteBehavior = "ask" | "overwrite" | "noOverwrite";

export type LogLevel =
  | "quiet"
  | "panic"
  | "fatal"
  | "error"
  | "warning"
  | "info"
  | "verbose"
  | "debug"
  | "trace";

export interface GlobalConfig {
  /** Whether to overwrite existing OUTPUT files. Undefined = ffmpeg default. */
  overwriteBehavior?: OverwriteBehavior;
  /** Optional ffmpeg loglevel; when unset, use ffmpeg default behaviour. */
  logLevel?: LogLevel;
  /** When true, hide the startup banner to keep logs compact. */
  hideBanner?: boolean;
  /** When true, enable `-report` so ffmpeg writes a diagnostic log file. */
  enableReport?: boolean;
}

export type SeekMode = "input" | "output";
export type DurationMode = "duration" | "to";

export interface InputTimelineConfig {
  /**
   * Position of `-ss` relative to the first input.
   * - input  -> `-ss` appears before `-i INPUT` (fast seek, less accurate)
   * - output -> `-ss` appears after `-i INPUT` (slower, more accurate)
   */
  seekMode?: SeekMode;
  /** Raw time expression for `-ss`, e.g. `00:01:23.000` or `90`. */
  seekPosition?: string;
  /**
   * Whether to express clipping by duration (`-t`) or absolute end time (`-to`).
   * Undefined means no explicit clip limit.
   */
  durationMode?: DurationMode;
  /** Raw time expression used with `-t` or `-to`, depending on durationMode. */
  duration?: string;
  /** When true, append `-accurate_seek` alongside `-ss` for precise seeking. */
  accurateSeek?: boolean;
}

export interface MappingConfig {
  /**
   * Raw `-map` directives. Each entry becomes a `-map <value>` pair
   * in the generated ffmpeg command.
   */
  maps?: string[];
  /** Raw `-metadata` key/value pairs expressed as `key=value` strings. */
  metadata?: string[];
  /** Raw `-disposition` arguments, e.g. `0:v:0 default`. */
  dispositions?: string[];
}

export type SubtitleStrategy = "keep" | "drop" | "burn_in";

export interface SubtitlesConfig {
  /** High-level subtitle handling strategy for this preset. */
  strategy?: SubtitleStrategy;
  /**
   * Optional filter expression used when `strategy === "burn_in"`, e.g.
   * `subtitles=INPUT:si=0`. This is appended into the video filter chain.
   */
  burnInFilter?: string;
}

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
  /** Optional encoder level string, e.g. `4.1` or `high`. */
  level?: string;
  /** Optional GOP size (mapped to `-g`). */
  gopSize?: number;
  /** Optional B-frame count (mapped to `-bf`). */
  bf?: number;
  /** Optional pixel format, e.g. `yuv420p`. */
  pixFmt?: string;
}

export interface AudioConfig {
  codec: AudioCodecType;
  /** Target audio bitrate in kbps when transcoding (mapped to `-b:a`). */
  bitrate?: number;
  /** Optional audio sample rate in Hz (mapped to `-ar`). */
  sampleRateHz?: number;
  /** Optional audio channel count (mapped to `-ac`). */
  channels?: number;
  /** Optional channel layout string, e.g. `stereo`, `5.1`. */
  channelLayout?: string;
  /**
   * Optional loudness normalization profile applied via `loudnorm` in the
   * audio filter chain. When undefined or `"none"`, no loudness filter is
   * injected and callers may still use raw `afChain`.
   */
  loudnessProfile?: AudioLoudnessProfile;
  /**
   * Optional target integrated loudness in LUFS used when constructing a
   * `loudnorm` expression. When omitted, we fall back to profile defaults.
   */
  targetLufs?: number;
  /**
   * Optional target loudness range (LRA). When omitted, we fall back to
   * profile defaults chosen from safe ranges in the FFmpeg guides.
   */
  loudnessRange?: number;
  /**
   * Optional true-peak limit in dBTP. When omitted, we fall back to profile
   * defaults; values close to 0dBTP are considered unsafe and may be clamped.
   */
  truePeakDb?: number;
}

export interface FilterConfig {
  /** Shorthand expression for scale filter, e.g. `-2:1080`. */
  scale?: string;
  /** Shorthand expression for crop filter. */
  crop?: string;
  /** Target output FPS for basic frame rate limiting. */
  fps?: number;
  /**
   * Optional raw `-vf` chain appended after shorthand filters. This allows
   * advanced users to add extra nodes without leaving structured mode.
   */
  vfChain?: string;
  /** Optional raw `-af` chain mapped directly to `-af`. */
  afChain?: string;
  /** Optional raw complex filter graph mapped to `-filter_complex`. */
  filterComplex?: string;
}

export interface ContainerConfig {
  /** Optional explicit output format/muxer name, mapped to `-f`. */
  format?: string;
  /**
   * Optional movflags list (e.g. `faststart`, `frag_keyframe`); when present
   * they are joined as `flag1+flag2` in a single `-movflags` argument.
   */
  movflags?: string[];
}

export interface HardwareConfig {
  /** Optional hardware acceleration backend, e.g. `cuda`, `qsv`. */
  hwaccel?: string;
  /** Optional device identifier for hwaccel, e.g. `cuda:0`. */
  hwaccelDevice?: string;
  /** Optional hwaccel output pixel format, e.g. `cuda`. */
  hwaccelOutputFormat?: string;
  /**
   * Optional list of bitstream filters, mapped to one or more `-bsf` flags.
   * Entries are passed through as-is so advanced users can control stream
   * selectors and filter names.
   */
  bitstreamFilters?: string[];
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
  /** Optional global ffmpeg options (loglevel, overwrite, banner, report). */
  global?: GlobalConfig;
  /** Optional input/timeline options (seek / trim). */
  input?: InputTimelineConfig;
  /** Optional stream mapping and metadata controls. */
  mapping?: MappingConfig;
  video: VideoConfig;
  audio: AudioConfig;
  filters: FilterConfig;
  /** Optional subtitle handling strategy for this preset. */
  subtitles?: SubtitlesConfig;
  /** Optional container/muxer-level options. */
  container?: ContainerConfig;
  /** Optional hardware/bitstream filter configuration. */
  hardware?: HardwareConfig;
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
  /** When true, enable developer features such as opening devtools from the UI. */
  developerModeEnabled?: boolean;
  /** Optional default preset id used for manual queue jobs. */
  defaultQueuePresetId?: string;
  /** Optional upper bound for concurrent ffmpeg jobs; 0 or undefined means auto. */
  maxParallelJobs?: number;
  /** Optional interval in milliseconds between backend progress updates for ffmpeg jobs (bundled binary only). */
  progressUpdateIntervalMs?: number;
  /** Optional interval in milliseconds between system metrics samples for the performance monitor. */
  metricsIntervalMs?: number;
  /** Aggregation mode for computing Windows taskbar progress from the queue. */
  taskbarProgressMode?: TaskbarProgressMode;
}

export type ExternalToolKind = "ffmpeg" | "ffprobe" | "avifenc";

export interface ExternalToolStatus {
  kind: ExternalToolKind;
  resolvedPath?: string;
  source?: string;
  version?: string;
  /** Latest remote version string when known (for update hints). */
  remoteVersion?: string;
  updateAvailable: boolean;
  autoDownloadEnabled: boolean;
  autoUpdateEnabled: boolean;
  /** True when the backend is currently auto-downloading this tool. */
  downloadInProgress: boolean;
  /** Optional percentage progress (0-100); when undefined, treat as indeterminate spinner. */
  downloadProgress?: number;
  /** Total bytes downloaded so far for the current auto-download, when known. */
  downloadedBytes?: number;
  /** Total expected size in bytes for the current auto-download when known. */
  totalBytes?: number;
  /** Smoothed download speed in bytes per second when known. */
  bytesPerSecond?: number;
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

// ----- System performance monitoring (system-metrics://update) -----

export interface CpuMetrics {
  cores: number[];
  total: number;
}

export interface MemoryMetrics {
  usedBytes: number;
  totalBytes: number;
}

export interface DiskIoMetrics {
  device: string;
  readBps: number;
  writeBps: number;
}

export interface DiskMetrics {
  io: DiskIoMetrics[];
}

export interface NetworkInterfaceMetrics {
  name: string;
  rxBps: number;
  txBps: number;
}

export interface NetworkMetrics {
  interfaces: NetworkInterfaceMetrics[];
}

export interface SystemMetricsSnapshot {
  timestamp: number;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics;
  network: NetworkMetrics;
  /** Optional NVIDIA GPU usage snapshot sampled alongside system metrics. */
  gpu?: GpuUsageSnapshot;
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
