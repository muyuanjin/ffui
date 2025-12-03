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
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";
export type JobType = "video" | "image";
export type JobSource = "manual" | "smart_scan";

export interface MediaInfo {
  durationSeconds?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  videoCodec?: string;
  audioCodec?: string;
  sizeMB?: number;
}

export interface TranscodeJob {
  id: string;
  filename: string;
  type: JobType;
  source: JobSource;
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
  /** Optional thumbnail path for this job's input media. */
  previewPath?: string;
  /** Tail string of logs for display in the detail view. */
  logTail?: string;
  /** Short structured description of why the job failed. */
  failureReason?: string;
}

export interface SmartScanConfig {
  minImageSizeKB: number;
  minVideoSizeMB: number;
  minSavingRatio: number;
  imageTargetFormat: "avif" | "webp";
  videoPresetId: string;
}

export interface ExternalToolSettings {
  ffmpegPath?: string;
  ffprobePath?: string;
  avifencPath?: string;
  autoDownload: boolean;
  autoUpdate: boolean;
}

export interface AppSettings {
  tools: ExternalToolSettings;
  smartScanDefaults: SmartScanConfig;
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
}

export interface QueueState {
  jobs: TranscodeJob[];
}
