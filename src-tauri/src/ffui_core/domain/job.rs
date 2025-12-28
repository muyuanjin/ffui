pub use super::job_logs::JobLogLine;
use super::output_policy::OutputPolicy;
use serde::{Deserialize, Serialize};
#[allow(clippy::trivially_copy_pass_by_ref)]
const fn is_zero(v: &u64) -> bool {
    *v == 0
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitMetadata {
    /// Last known overall progress percentage when the job was paused via a
    /// wait operation. This is expressed in the same 0-100 range as the
    /// `progress` field exposed in queue snapshots.
    pub last_progress_percent: Option<f64>,
    /// Accumulated wall-clock processing time in milliseconds across all
    /// completed segments before the current pause. This is used to ensure
    /// `elapsed_ms` reflects real time spent transcoding, instead of media
    /// duration-derived estimates.
    #[serde(rename = "processedWallMillis", alias = "processedWallMs")]
    pub processed_wall_millis: Option<u64>,
    /// Approximate number of seconds already processed when the job was
    /// paused. When media duration is unknown this may be None.
    pub processed_seconds: Option<f64>,
    pub target_seconds: Option<f64>,
    /// Optional monotonic epoch identifier for progress reporting. When the
    /// backend must “rewind” and re-encode earlier media (overlap resume,
    /// segment loss, conservative crash recovery), it MAY bump this value so
    /// the UI can treat subsequent progress as belonging to a new epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_epoch: Option<u64>,
    /// Best-effort last seen `-progress` out_time (seconds) while the job was
    /// actively processing. This is persisted frequently for crash recovery so
    /// we can avoid relying solely on container duration guesses.
    pub last_progress_out_time_seconds: Option<f64>,
    /// Best-effort last seen ffmpeg progress speed (e.g. 1.5 for "1.5x").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_progress_speed: Option<f64>,
    /// Best-effort wall-clock timestamp (ms since epoch) for the last progress sample.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_progress_updated_at_ms: Option<u64>,
    /// Best-effort last seen `-progress` frame counter while the job was
    /// actively processing. This is primarily a diagnostic and recovery hint.
    pub last_progress_frame: Option<u64>,
    /// Path to a partial output segment or temporary output file, when
    /// available. This is intended for future crash-recovery and resume
    /// strategies; callers must tolerate it being absent.
    pub tmp_output_path: Option<String>,
    /// Ordered list of partial output segment paths accumulated across one
    /// or more pauses. 当存在多个暂停/继续时，后端会将每次生成的分段路径按时间
    /// 顺序追加到该列表，用于最终 concat 多段输出。对于仅包含单段的旧快照，
    /// 此字段可能为 None，此时仍需回退到 `tmp_output_path` 以保持兼容。
    pub segments: Option<Vec<String>>,
    /// Ordered list of join target times (seconds) after each completed output segment.
    pub segment_end_targets: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobWarning {
    /// Stable machine-readable warning identifier.
    pub code: String,
    /// User-facing description suitable for UI tooltips.
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    #[serde(alias = "waiting")]
    Queued,
    Processing,
    Paused,
    Completed,
    Failed,
    Skipped,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobType {
    Video,
    Image,
    Audio,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobSource {
    Manual,
    BatchCompress,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub duration_seconds: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub frame_rate: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    // Align with TS field name `sizeMB` but accept a legacy `sizeMb` variant
    // if we ever persisted older JSON on disk.
    #[serde(rename = "sizeMB", alias = "sizeMb")]
    pub size_mb: Option<f64>,
}

/// Represents a single external tool "run" for a job (e.g. the initial ffmpeg
/// launch, a resume run with `-ss ...`, or a retry after restart).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobRun {
    /// Copy-safe command string for this run (quoted, user-facing).
    pub command: String,
    /// Log lines emitted during this run (bounded).
    #[serde(
        default,
        deserialize_with = "super::job_logs::deserialize_job_log_lines"
    )]
    pub logs: Vec<JobLogLine>,
    /// Best-effort wall-clock start time for this run in milliseconds since epoch.
    pub started_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeJob {
    /* jscpd:ignore-start */
    pub id: String,
    pub filename: String,
    #[serde(rename = "type")]
    pub job_type: JobType,
    pub source: JobSource,
    /// Stable execution priority within the waiting queue. Lower values are
    /// scheduled earlier. The frontend uses this for queue-mode ordering while
    /// treating it as metadata in display-only mode.
    #[serde(rename = "queueOrder")]
    pub queue_order: Option<u64>,
    // Align with TS field name `originalSizeMB` but accept legacy
    // `originalSizeMb` when deserializing.
    #[serde(rename = "originalSizeMB", alias = "originalSizeMb")]
    pub original_size_mb: f64,
    pub original_codec: Option<String>,
    pub preset_id: String,
    pub status: JobStatus,
    pub progress: f64,
    pub start_time: Option<u64>,
    pub end_time: Option<u64>,
    /// 实际开始处理的时间戳（毫秒），用于计算纯处理耗时（不含排队）。
    #[serde(rename = "processingStartedMs")]
    pub processing_started_ms: Option<u64>,
    /// 累计已用转码时间（毫秒）。用于处理暂停/恢复场景，在暂停时保存当前累计时间，
    /// 恢复后继续累加。对于未暂停过的任务，可通过 (当前时间 - `start_time`) 计算。
    pub elapsed_ms: Option<u64>,
    // Align with TS field name `outputSizeMB` but accept legacy
    // `outputSizeMb` when deserializing.
    #[serde(rename = "outputSizeMB", alias = "outputSizeMb")]
    pub output_size_mb: Option<f64>, /* jscpd:ignore-end */
    /// Rolling window of recent log lines for this job. The UI uses this to
    /// display progressive output and debugging details.
    #[serde(
        default,
        deserialize_with = "super::job_logs::deserialize_job_log_lines"
    )]
    pub logs: Vec<JobLogLine>,
    /// Optional pre-truncated head lines of logs for this job. This is used
    /// for crash recovery persistence so users can still see important context
    /// (ffmpeg version, stream info) after restart without storing full logs
    /// in the queue snapshot.
    pub log_head: Option<Vec<String>>,
    pub skip_reason: Option<String>,
    /// Absolute input path for this job. For newly created jobs this is
    /// always populated, but it is optional at the serde level to remain
    /// compatible with any legacy JSON that does not carry it.
    pub input_path: Option<String>,
    /// Best-effort input file creation/birth time in milliseconds since epoch.
    /// On platforms that do not expose birth time, this may fall back to inode
    /// change time (ctime).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_time_ms: Option<u64>,
    /// Best-effort input file modified time in milliseconds since epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_time_ms: Option<u64>,
    /// Planned or final output path for this job. For video transcodes this
    /// points at the `.compressed.*` target, even before the file exists.
    pub output_path: Option<String>,
    /// Output policy snapshot captured at enqueue time so later changes to
    /// defaults do not affect already-enqueued jobs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_policy: Option<OutputPolicy>,
    /// Human-readable ffmpeg command line used for this job, with quoted
    /// arguments so it can be copy/pasted from the UI.
    pub ffmpeg_command: Option<String>,
    /// Ordered history of external tool invocations for this job.
    ///
    /// This binds a per-run command string to the corresponding log lines so
    /// pause/resume/restart scenarios remain debuggable.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runs: Vec<JobRun>,
    /// Compact media metadata derived from ffprobe or existing job fields.
    pub media_info: Option<MediaInfo>,
    /// Optional estimated processing time in seconds for this job. This is
    /// used for aggregated progress weighting (e.g. Windows taskbar) so
    /// small but heavy presets can contribute more accurately than size
    /// alone would suggest.
    pub estimated_seconds: Option<f64>,
    /// Optional preview image path for this job, typically a JPEG/PNG frame
    /// extracted from the input video and stored near the app data folder.
    pub preview_path: Option<String>,
    /// Monotonic revision that changes when the preview file is (re)generated.
    ///
    /// This allows the frontend to cache-bust preview URLs even when the
    /// preview path itself is stable (e.g. hash-based filenames).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub preview_revision: u64,
    /// Bounded textual tail of stderr/stdout logs for this job, suitable
    /// for rendering in the task detail view without unbounded growth.
    pub log_tail: Option<String>,
    /// Short, structured reason string describing why a job failed. This is
    /// separate from raw logs so the UI can surface a concise headline.
    pub failure_reason: Option<String>,
    /// Structured warnings that should remain visible on the task card.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<JobWarning>,
    /// Optional stable identifier for a Batch Compress batch this job belongs to.
    /// Manual / ad-hoc jobs do not carry a batch id.
    pub batch_id: Option<String>,
    /// Optional metadata captured when a job is paused via an explicit wait
    /// operation or restored after an unexpected termination. This keeps the
    /// core `TranscodeJob` shape stable while allowing future resume/crash-
    /// recovery strategies to evolve.
    pub wait_metadata: Option<WaitMetadata>,
}

impl TranscodeJob {
    /// Best-effort migration hook for legacy persisted jobs that only stored a
    /// single `ffmpegCommand` + flat `logs[]` without explicit run history.
    pub fn ensure_run_history_from_legacy(&mut self) {
        if !self.runs.is_empty() {
            return;
        }

        // Jobs that have not started yet should not synthesize a placeholder
        // run entry from the planned command. Runs represent actual external
        // invocations.
        if matches!(self.status, JobStatus::Queued) {
            return;
        }

        if self.ffmpeg_command.is_none() && self.logs.is_empty() {
            return;
        }

        self.runs.push(JobRun {
            command: self.ffmpeg_command.clone().unwrap_or_default(),
            logs: self.logs.clone(),
            started_at_ms: self.start_time,
        });
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueState {
    pub jobs: Vec<TranscodeJob>,
}
// Queue-lite snapshot types live in `job_lite.rs`.
