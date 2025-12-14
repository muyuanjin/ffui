use serde::{Deserialize, Serialize};

use super::output_policy::OutputPolicy;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitMetadata {
    /// Last known overall progress percentage when the job was paused via a
    /// wait operation. This is expressed in the same 0-100 range as the
    /// `progress` field exposed in queue snapshots.
    pub last_progress_percent: Option<f64>,
    /// Accumulated wall-clock processing time in milliseconds across all
    /// completed segments before the current pause. This is used to ensure
    /// elapsed_ms reflects real time spent transcoding, instead of media
    /// duration-derived estimates.
    #[serde(rename = "processedWallMillis", alias = "processedWallMs")]
    pub processed_wall_millis: Option<u64>,
    /// Approximate number of seconds already processed when the job was
    /// paused. When media duration is unknown this may be None.
    pub processed_seconds: Option<f64>,
    /// Path to a partial output segment or temporary output file, when
    /// available. This is intended for future crash-recovery and resume
    /// strategies; callers must tolerate it being absent.
    pub tmp_output_path: Option<String>,
    /// Ordered list of partial output segment paths accumulated across one
    /// or more pauses. 当存在多个暂停/继续时，后端会将每次生成的分段路径按时间
    /// 顺序追加到该列表，用于最终 concat 多段输出。对于仅包含单段的旧快照，
    /// 此字段可能为 None，此时仍需回退到 `tmp_output_path` 以保持兼容。
    pub segments: Option<Vec<String>>,
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
    Audio,
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
    /// 实际开始处理的时间戳（毫秒），用于计算纯处理耗时（不含排队）。
    #[serde(rename = "processingStartedMs")]
    pub processing_started_ms: Option<u64>,
    /// 累计已用转码时间（毫秒）。用于处理暂停/恢复场景，在暂停时保存当前累计时间，
    /// 恢复后继续累加。对于未暂停过的任务，可通过 (当前时间 - start_time) 计算。
    pub elapsed_ms: Option<u64>,
    // Align with TS field name `outputSizeMB` but accept legacy
    // `outputSizeMb` when deserializing.
    #[serde(rename = "outputSizeMB", alias = "outputSizeMb")]
    pub output_size_mb: Option<f64>,
    /// Rolling window of recent log lines for this job. The UI uses this to
    /// display progressive output and debugging details.
    pub logs: Vec<String>,
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

/// Lightweight view of a transcode job used for high-frequency queue
/// snapshots and startup payloads. This intentionally omits heavy log
/// history fields such as the full `logs` vector while keeping all fields
/// needed for list rendering, sorting, bulk operations, and displaying /
/// copying the effective ffmpeg command line in the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeJobLite {
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
    /// 累计已用转码时间（毫秒）。
    pub elapsed_ms: Option<u64>,
    // Align with TS field name `outputSizeMB` but accept legacy
    // `outputSizeMb` when deserializing.
    #[serde(rename = "outputSizeMB", alias = "outputSizeMb")]
    pub output_size_mb: Option<f64>,
    /// Absolute input path for this job when known (Tauri only).
    pub input_path: Option<String>,
    /// Planned or final output path for this job (e.g. .compressed.mp4).
    pub output_path: Option<String>,
    /// Output policy snapshot captured at enqueue time.
    pub output_policy: Option<OutputPolicy>,
    /// Human-readable ffmpeg command line used for this job. Unlike the full
    /// `logs` vector this is required for the UI to render task cards and
    /// details correctly, so it is preserved in the lite snapshot.
    pub ffmpeg_command: Option<String>,
    /// Short human-readable reason for why a job was skipped. This is used by
    /// the queue list to surface skip context even when the full logs are
    /// omitted from the lite snapshot.
    pub skip_reason: Option<String>,
    /// Compact media metadata derived from ffprobe or existing job fields.
    pub media_info: Option<MediaInfo>,
    /// Optional estimated processing time in seconds for this job. This is
    /// used for aggregated progress weighting (e.g. Windows taskbar).
    pub estimated_seconds: Option<f64>,
    /// Optional thumbnail path for this job's input media.
    pub preview_path: Option<String>,
    /// Optional pre-truncated tail string of logs from the backend. The
    /// detail view prefers the full in-memory logs when available and falls
    /// back to this tail for legacy snapshots.
    pub log_tail: Option<String>,
    /// Optional pre-truncated head lines of logs from the backend. This is
    /// used for crash recovery persistence so users can still see important
    /// context lines (ffmpeg version, input streams) after restart without
    /// storing the full logs on hot paths.
    pub log_head: Option<Vec<String>>,
    /// Short structured description of why the job failed.
    pub failure_reason: Option<String>,
    /// Optional stable id for the Smart Scan batch this job belongs to.
    pub batch_id: Option<String>,
    /// Optional metadata captured when a job is paused via wait or restored
    /// after crash recovery.
    pub wait_metadata: Option<WaitMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStateLite {
    pub jobs: Vec<TranscodeJobLite>,
}

impl From<&TranscodeJob> for TranscodeJobLite {
    fn from(job: &TranscodeJob) -> Self {
        const LOG_HEAD_LINES: usize = 20;
        let log_head = if job.logs.is_empty() {
            None
        } else {
            Some(job.logs.iter().take(LOG_HEAD_LINES).cloned().collect())
        };

        Self {
            id: job.id.clone(),
            filename: job.filename.clone(),
            job_type: job.job_type.clone(),
            source: job.source.clone(),
            queue_order: job.queue_order,
            original_size_mb: job.original_size_mb,
            original_codec: job.original_codec.clone(),
            preset_id: job.preset_id.clone(),
            status: job.status.clone(),
            progress: job.progress,
            start_time: job.start_time,
            end_time: job.end_time,
            processing_started_ms: job.processing_started_ms,
            elapsed_ms: job.elapsed_ms,
            output_size_mb: job.output_size_mb,
            input_path: job.input_path.clone(),
            output_path: job.output_path.clone(),
            output_policy: job.output_policy.clone(),
            ffmpeg_command: job.ffmpeg_command.clone(),
            skip_reason: job.skip_reason.clone(),
            media_info: job.media_info.clone(),
            estimated_seconds: job.estimated_seconds,
            preview_path: job.preview_path.clone(),
            log_tail: job.log_tail.clone(),
            log_head,
            failure_reason: job.failure_reason.clone(),
            batch_id: job.batch_id.clone(),
            wait_metadata: job.wait_metadata.clone(),
        }
    }
}

impl From<&QueueState> for QueueStateLite {
    fn from(snapshot: &QueueState) -> Self {
        let jobs = snapshot.jobs.iter().map(TranscodeJobLite::from).collect();
        QueueStateLite { jobs }
    }
}

impl From<TranscodeJobLite> for TranscodeJob {
    fn from(job: TranscodeJobLite) -> Self {
        // `QueueStateLite` intentionally does not restore full logs into memory.
        // The optional `logHead` / `logTail` snippets are used for UI display,
        // while full logs may be restored via per-job files in CrashRecoveryFull.

        Self {
            id: job.id,
            filename: job.filename,
            job_type: job.job_type,
            source: job.source,
            queue_order: job.queue_order,
            original_size_mb: job.original_size_mb,
            original_codec: job.original_codec,
            preset_id: job.preset_id,
            status: job.status,
            progress: job.progress,
            start_time: job.start_time,
            end_time: job.end_time,
            processing_started_ms: job.processing_started_ms,
            elapsed_ms: job.elapsed_ms,
            output_size_mb: job.output_size_mb,
            logs: Vec::new(),
            log_head: job.log_head,
            skip_reason: job.skip_reason,
            input_path: job.input_path,
            output_path: job.output_path,
            output_policy: job.output_policy,
            ffmpeg_command: job.ffmpeg_command,
            media_info: job.media_info,
            estimated_seconds: job.estimated_seconds,
            preview_path: job.preview_path,
            log_tail: job.log_tail,
            failure_reason: job.failure_reason,
            batch_id: job.batch_id,
            wait_metadata: job.wait_metadata,
        }
    }
}

impl From<QueueStateLite> for QueueState {
    fn from(snapshot: QueueStateLite) -> Self {
        let jobs = snapshot.jobs.into_iter().map(TranscodeJob::from).collect();
        QueueState { jobs }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_state_lite_json_omits_full_logs_vector() {
        let snapshot = QueueStateLite {
            jobs: vec![TranscodeJobLite {
                id: "job-1".to_string(),
                filename: "C:/videos/sample.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::Manual,
                queue_order: None,
                original_size_mb: 0.0,
                original_codec: None,
                preset_id: "preset-1".to_string(),
                status: JobStatus::Waiting,
                progress: 0.0,
                start_time: None,
                end_time: None,
                processing_started_ms: None,
                elapsed_ms: None,
                output_size_mb: None,
                input_path: None,
                output_path: None,
                output_policy: None,
                ffmpeg_command: None,
                skip_reason: None,
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                log_tail: None,
                log_head: Some(vec!["ffmpeg version ...".to_string()]),
                failure_reason: None,
                batch_id: None,
                wait_metadata: None,
            }],
        };

        let json = serde_json::to_value(snapshot).expect("serialize QueueStateLite");
        let job = &json["jobs"][0];

        assert!(
            job.get("logs").is_none(),
            "QueueStateLite must not include logs"
        );
        assert!(
            job.get("logHead").is_some(),
            "QueueStateLite keeps lightweight log snippets"
        );
    }
}
