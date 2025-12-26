import type { OutputPolicy } from "./output-policy";

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
export type JobSource = "manual" | "batch_compress";

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
  | "dynamic-card"
  | "carousel-3d";

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
  /** Accumulated wall-clock processing time in milliseconds at the moment of pause. */
  processedWallMillis?: number;
  /** Approximate number of seconds already processed when the job was paused. */
  processedSeconds?: number;
  /** Intended join target time in seconds for restart-based resume. */
  targetSeconds?: number;
  /**
   * Best-effort last seen ffmpeg `-progress` out_time while the job is actively
   * processing (seconds). Used for crash recovery to avoid relying only on
   * container duration heuristics.
   */
  lastProgressOutTimeSeconds?: number;
  /**
   * Best-effort last seen ffmpeg `-progress` frame counter while the job is
   * actively processing. Primarily a diagnostic + recovery hint.
   */
  lastProgressFrame?: number;
  /** Path to a partial or temporary output file captured during processing. */
  tmpOutputPath?: string;
  /**
   * Ordered list of partial output segment paths accumulated across pauses.
   * 对于仅有一次暂停的旧任务，该字段可能缺失，此时仍需回退到 tmpOutputPath。
   */
  segments?: string[];
  /**
   * Ordered list of join target times (seconds) after each completed output
   * segment. Used to build concat lists with explicit durations so timestamps
   * remain stable across pauses/resumes.
   */
  segmentEndTargets?: number[];
}

export type JobCompareOutput =
  | { kind: "completed"; outputPath: string }
  | {
      kind: "partial";
      segmentPaths: string[];
      activeSegmentPath?: string | null;
    };

export interface JobCompareSources {
  jobId: string;
  inputPath: string;
  output: JobCompareOutput;
  /**
   * Maximum comparable media time in seconds for partial jobs. Completed jobs
   * may omit this so the frontend can derive range from media durations.
   */
  maxCompareSeconds?: number | null;
}

export interface JobWarning {
  /** Stable machine-readable warning identifier. */
  code: string;
  /** User-facing description suitable for UI tooltips. */
  message: string;
}

export interface JobRun {
  /** Copy-safe command string for this run (quoted, user-facing). */
  command: string;
  /** Log lines emitted during this run (bounded). */
  logs?: string[];
  /** Best-effort wall-clock start time for this run in milliseconds since epoch. */
  startedAtMs?: number;
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
  /** 实际开始处理的时间戳（毫秒），用于计算纯处理耗时（不含排队）。 */
  processingStartedMs?: number;
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
  /** Output policy snapshot captured at enqueue time. */
  outputPolicy?: OutputPolicy;
  /** Human-readable ffmpeg command used for this job. */
  ffmpegCommand?: string;
  /** Ordered history of external tool invocations for this job. */
  runs?: JobRun[];
  /** Compact media metadata for the job's input file. */
  mediaInfo?: MediaInfo;
  /** Optional estimated processing time in seconds for this job, used for aggregated progress weighting. */
  estimatedSeconds?: number;
  /** Optional thumbnail path for this job's input media. */
  previewPath?: string;
  /**
   * Monotonic revision that changes when the preview file is (re)generated.
   * Used to cache-bust preview URLs even when `previewPath` is stable.
   */
  previewRevision?: number;
  /** Optional pre-truncated tail string of logs from the backend. The detail view prefers the full in-memory logs when available and falls back to this tail for legacy snapshots. */
  logTail?: string;
  /** Short structured description of why the job failed. */
  failureReason?: string;
  /** Structured warnings that should remain visible on the task card. */
  warnings?: JobWarning[];
  /** Optional stable id for the Batch Compress batch this job belongs to. */
  batchId?: string;
  /** Optional metadata captured when a job is paused via wait or restored after crash recovery. */
  waitMetadata?: WaitMetadata;
}

/**
 * Lightweight job snapshot used by `QueueStateLite`.
 *
 * The backend intentionally omits heavyweight fields (full logs) on the hot
 * path to keep startup and high-frequency queue updates cheap, but it may
 * still carry bounded log head/tail snippets for crash recovery UX.
 */
export type TranscodeJobLite = Omit<TranscodeJob, "logs" | "runs"> & {
  /** Optional head snippet of logs (bounded) for crash recovery UX. */
  logHead?: string[];
};

export interface QueueState {
  jobs: TranscodeJob[];
}

/**
 * Lightweight queue snapshot shape used by startup and high-frequency updates.
 *
 * Note: `QueueStateLite` intentionally does NOT include per-job `logs` so UI
 * code does not accidentally treat lite events as a source of full log history.
 */
export interface QueueStateLite {
  /** Monotonic snapshot revision for ordering / de-duping. */
  snapshotRevision?: number;
  jobs: TranscodeJobLite[];
}
