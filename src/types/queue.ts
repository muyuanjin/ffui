export type JobStatus =
  | "waiting"
  | "queued"
  | "processing"
  | "paused"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";
export type JobType = "video" | "image" | "audio";
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
  /**
   * Ordered list of partial output segment paths accumulated across pauses.
   * 对于仅有一次暂停的旧任务，该字段可能缺失，此时仍需回退到 tmpOutputPath。
   */
  segments?: string[];
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
  /**
   * 累计已用转码时间（毫秒）。用于处理暂停/恢复场景，在暂停时保存当前累计时间，
   * 恢复后继续累加。对于未暂停过的任务，可通过 (当前时间 - startTime) 计算。
   */
  elapsedMs?: number;
  outputSizeMB?: number;
  logs?: string[];
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

export interface QueueState {
  jobs: TranscodeJob[];
}

// Lightweight queue snapshot shape used by startup and high-frequency
// updates. It intentionally omits heavy fields (such as full logs) on the
// backend side while keeping the TS surface compatible with QueueState.
export type QueueStateLite = QueueState;
