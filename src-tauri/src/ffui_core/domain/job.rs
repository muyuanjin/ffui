use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitMetadata {
    /// Last known overall progress percentage when the job was paused via a
    /// wait operation. This is expressed in the same 0-100 range as the
    /// `progress` field exposed in queue snapshots.
    pub last_progress_percent: Option<f64>,
    /// Approximate number of seconds already processed when the job was
    /// paused. When media duration is unknown this may be None.
    pub processed_seconds: Option<f64>,
    /// Path to a partial output segment or temporary output file, when
    /// available. This is intended for future crash-recovery and resume
    /// strategies; callers must tolerate it being absent.
    pub tmp_output_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Waiting,
    Queued,
    Processing,
    Paused,
    Completed,
    Failed,
    Skipped,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobType {
    Video,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobSource {
    Manual,
    SmartScan,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeJob {
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
    // Align with TS field name `outputSizeMB` but accept legacy
    // `outputSizeMb` when deserializing.
    #[serde(rename = "outputSizeMB", alias = "outputSizeMb")]
    pub output_size_mb: Option<f64>,
    /// Rolling window of recent log lines for this job. The UI uses this to
    /// display progressive output and debugging details.
    pub logs: Vec<String>,
    pub skip_reason: Option<String>,
    /// Absolute input path for this job. For newly created jobs this is
    /// always populated, but it is optional at the serde level to remain
    /// compatible with any legacy JSON that does not carry it.
    pub input_path: Option<String>,
    /// Planned or final output path for this job. For video transcodes this
    /// points at the `.compressed.*` target, even before the file exists.
    pub output_path: Option<String>,
    /// Human-readable ffmpeg command line used for this job, with quoted
    /// arguments so it can be copy/pasted from the UI.
    pub ffmpeg_command: Option<String>,
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
    /// Bounded textual tail of stderr/stdout logs for this job, suitable
    /// for rendering in the task detail view without unbounded growth.
    pub log_tail: Option<String>,
    /// Short, structured reason string describing why a job failed. This is
    /// separate from raw logs so the UI can surface a concise headline.
    pub failure_reason: Option<String>,
    /// Optional stable identifier for a Smart Scan batch this job belongs to.
    /// Manual / ad-hoc jobs do not carry a batch id.
    pub batch_id: Option<String>,
    /// Optional metadata captured when a job is paused via an explicit wait
    /// operation or restored after an unexpected termination. This keeps the
    /// core `TranscodeJob` shape stable while allowing future resume/crash-
    /// recovery strategies to evolve.
    pub wait_metadata: Option<WaitMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueState {
    pub jobs: Vec<TranscodeJob>,
}
