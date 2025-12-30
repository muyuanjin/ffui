use serde::{Deserialize, Serialize};

use super::job::{
    JobConfig, JobRun, JobSource, JobStatus, JobType, JobWarning, MediaInfo, QueueState,
    TranscodeJob, WaitMetadata,
};
use super::output_policy::OutputPolicy;

#[allow(clippy::trivially_copy_pass_by_ref)]
const fn is_zero(v: &u64) -> bool {
    *v == 0
}

// Lightweight view of a transcode job used for high-frequency queue snapshots.
// Omits heavyweight fields like full logs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeJobLite {
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
    /// 累计已用转码时间（毫秒）。
    pub elapsed_ms: Option<u64>,
    // Align with TS field name `outputSizeMB` but accept legacy
    // `outputSizeMb` when deserializing.
    #[serde(rename = "outputSizeMB", alias = "outputSizeMb")]
    pub output_size_mb: Option<f64>, /* jscpd:ignore-end */
    /// Absolute input path for this job when known (Tauri only).
    pub input_path: Option<String>,
    /// Best-effort input file creation/birth time in milliseconds since epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_time_ms: Option<u64>,
    /// Best-effort input file modified time in milliseconds since epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_time_ms: Option<u64>,
    /// Planned or final output path for this job (e.g. .compressed.mp4).
    pub output_path: Option<String>,
    /// Output policy snapshot captured at enqueue time.
    pub output_policy: Option<OutputPolicy>,
    /// Planned/template ffmpeg command for this job.
    pub ffmpeg_command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_run_command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_run_started_at_ms: Option<u64>,
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
    /// Monotonic revision that changes when the preview file is (re)generated.
    ///
    /// See `TranscodeJob.preview_revision`.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub preview_revision: u64,
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
    /// Structured warnings that should remain visible on the task card.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<JobWarning>,
    /// Optional stable id for the Batch Compress batch this job belongs to.
    pub batch_id: Option<String>,
    /// Optional metadata captured when a job is paused via wait or restored
    /// after crash recovery.
    pub wait_metadata: Option<WaitMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStateLite {
    /// Monotonic revision of this snapshot for ordering / de-duping on the frontend.
    ///
    /// This is not persisted as a stable identifier across restarts; it only needs
    /// to be monotonic within a single app session so the UI can ignore stale,
    /// out-of-order IPC deliveries.
    ///
    /// Note: This revision is intended to represent the *structural* version of
    /// the queue (add/remove/reorder/status transitions). High-frequency progress
    /// updates SHOULD use a delta stream instead of emitting new full snapshots.
    #[serde(default)]
    pub snapshot_revision: u64,
    pub jobs: Vec<TranscodeJobLite>,
}

/// Delta updates for the queue-lite stream.
///
/// Designed so high-frequency progress/preview updates can be delivered without
/// sending a full `QueueStateLite` snapshot each tick.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStateLiteDelta {
    /// The `QueueStateLite.snapshotRevision` this delta is based on.
    pub base_snapshot_revision: u64,
    /// Monotonic revision for deltas within the same `baseSnapshotRevision`.
    pub delta_revision: u64,
    /// Per-job field patches.
    pub patches: Vec<TranscodeJobLiteDeltaPatch>,
}

/// Grouped progress telemetry patch applied onto `TranscodeJob.waitMetadata`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeJobLiteTelemetryDelta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_epoch: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_progress_out_time_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_progress_speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_progress_updated_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_progress_frame: Option<u64>,
}

/// Grouped preview patch applied onto `TranscodeJob.previewPath` / `previewRevision`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeJobLitePreviewDelta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeJobLiteDeltaPatch {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<JobStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    /// Optional grouped progress telemetry applied onto `waitMetadata`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telemetry: Option<TranscodeJobLiteTelemetryDelta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
    /// Optional grouped preview patch applied onto `previewPath` / `previewRevision`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<TranscodeJobLitePreviewDelta>,
}

impl From<&TranscodeJob> for TranscodeJobLite {
    fn from(job: &TranscodeJob) -> Self {
        let config = JobConfig::from(job);
        const LOG_HEAD_LINES: usize = 20;
        let log_head = if job.logs.is_empty() {
            None
        } else {
            Some(
                job.logs
                    .iter()
                    .take(LOG_HEAD_LINES)
                    .map(|line| line.text.clone())
                    .collect(),
            )
        };
        let (first_run_command, first_run_started_at_ms) = job
            .runs
            .first()
            .map_or((None, None), |r| (Some(r.command.clone()), r.started_at_ms));

        Self {
            id: job.id.clone(),
            filename: config.filename,
            job_type: config.job_type,
            source: config.source,
            queue_order: job.queue_order,
            original_size_mb: config.original_size_mb,
            original_codec: config.original_codec,
            preset_id: config.preset_id,
            status: job.status,
            progress: job.progress,
            start_time: job.start_time,
            end_time: job.end_time,
            processing_started_ms: job.processing_started_ms,
            elapsed_ms: job.elapsed_ms,
            output_size_mb: job.output_size_mb,
            input_path: config.input_path,
            created_time_ms: config.created_time_ms,
            modified_time_ms: config.modified_time_ms,
            output_path: config.output_path,
            output_policy: config.output_policy,
            ffmpeg_command: job.ffmpeg_command.clone(),
            first_run_command,
            first_run_started_at_ms,
            skip_reason: job.skip_reason.clone(),
            media_info: job.media_info.clone(),
            estimated_seconds: job.estimated_seconds,
            preview_path: job.preview_path.clone(),
            preview_revision: job.preview_revision,
            log_tail: job.log_tail.clone(),
            log_head,
            failure_reason: job.failure_reason.clone(),
            warnings: job.warnings.clone(),
            batch_id: config.batch_id,
            wait_metadata: job.wait_metadata.clone(),
        }
    }
}

impl From<&QueueState> for QueueStateLite {
    fn from(snapshot: &QueueState) -> Self {
        let jobs = snapshot.jobs.iter().map(TranscodeJobLite::from).collect();
        Self {
            snapshot_revision: 0,
            jobs,
        }
    }
}

impl From<TranscodeJobLite> for TranscodeJob {
    fn from(job: TranscodeJobLite) -> Self {
        // `QueueStateLite` intentionally does not restore full logs into memory.
        // The optional `logHead` / `logTail` snippets are used for UI display,
        // while full logs may be restored via per-job files in CrashRecoveryFull.

        let runs = job
            .first_run_command
            .as_deref()
            .map(|cmd| {
                vec![JobRun {
                    command: cmd.to_string(),
                    logs: Vec::new(),
                    started_at_ms: job.first_run_started_at_ms.or(job.start_time),
                }]
            })
            .unwrap_or_default();

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
            created_time_ms: job.created_time_ms,
            modified_time_ms: job.modified_time_ms,
            output_path: job.output_path,
            output_policy: job.output_policy,
            ffmpeg_command: job.ffmpeg_command,
            runs,
            media_info: job.media_info,
            estimated_seconds: job.estimated_seconds,
            preview_path: job.preview_path,
            preview_revision: job.preview_revision,
            log_tail: job.log_tail,
            failure_reason: job.failure_reason,
            warnings: job.warnings,
            batch_id: job.batch_id,
            wait_metadata: job.wait_metadata,
        }
    }
}

impl From<QueueStateLite> for QueueState {
    fn from(snapshot: QueueStateLite) -> Self {
        let jobs = snapshot.jobs.into_iter().map(TranscodeJob::from).collect();
        Self { jobs }
    }
}
