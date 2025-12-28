use serde::{Deserialize, Serialize};

use super::job::{
    JobSource, JobStatus, JobType, JobWarning, MediaInfo, TranscodeJob, WaitMetadata,
};
use super::job_lite::{QueueStateLite, TranscodeJobLite};
use super::output_policy::OutputPolicy;

#[allow(clippy::trivially_copy_pass_by_ref)]
const fn is_zero(v: &u64) -> bool {
    *v == 0
}

/// UI-facing snapshot of the transcoding queue.
///
/// This is intentionally slimmer than `QueueStateLite` (crash-recovery persistence)
/// so startup and high-frequency UI delivery do not ship recovery-only fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStateUiLite {
    #[serde(default)]
    pub snapshot_revision: u64,
    pub jobs: Vec<TranscodeJobUiLite>,
}

/// UI-facing wait/resume metadata.
///
/// Keeps only the fields needed by the queue list UI (progress smoothing, partial
/// output path) while omitting crash-recovery internals such as per-segment lists.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitMetadataUiLite {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_progress_percent: Option<f64>,
    #[serde(
        rename = "processedWallMillis",
        alias = "processedWallMs",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub processed_wall_millis: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processed_seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_epoch: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_progress_out_time_seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_progress_speed: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_progress_updated_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_progress_frame: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmp_output_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeJobUiLite {
    pub id: String,
    pub filename: String,
    #[serde(rename = "type")]
    pub job_type: JobType,
    pub source: JobSource,
    #[serde(rename = "queueOrder")]
    pub queue_order: Option<u64>,
    #[serde(rename = "originalSizeMB", alias = "originalSizeMb")]
    pub original_size_mb: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_codec: Option<String>,
    pub preset_id: String,
    pub status: JobStatus,
    /// True when the frontend requested a cooperative pause (`wait`) and the job
    /// is still running until ffmpeg reaches a safe point.
    #[serde(default)]
    pub wait_request_pending: bool,
    pub progress: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_time: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_time: Option<u64>,
    #[serde(
        rename = "processingStartedMs",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub processing_started_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
    #[serde(
        rename = "outputSizeMB",
        alias = "outputSizeMb",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub output_size_mb: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_time_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_time_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_policy: Option<OutputPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ffmpeg_command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_run_command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_run_started_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_info: Option<MediaInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_path: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub preview_revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_tail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<JobWarning>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub batch_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wait_metadata: Option<WaitMetadataUiLite>,
}

impl From<&WaitMetadata> for WaitMetadataUiLite {
    fn from(meta: &WaitMetadata) -> Self {
        Self {
            last_progress_percent: meta.last_progress_percent,
            processed_wall_millis: meta.processed_wall_millis,
            processed_seconds: meta.processed_seconds,
            target_seconds: meta.target_seconds,
            progress_epoch: meta.progress_epoch,
            last_progress_out_time_seconds: meta.last_progress_out_time_seconds,
            last_progress_speed: meta.last_progress_speed,
            last_progress_updated_at_ms: meta.last_progress_updated_at_ms,
            last_progress_frame: meta.last_progress_frame,
            tmp_output_path: meta.tmp_output_path.clone(),
        }
    }
}

impl From<TranscodeJobLite> for TranscodeJobUiLite {
    fn from(job: TranscodeJobLite) -> Self {
        let TranscodeJobLite {
            id,
            filename,
            job_type,
            source,
            queue_order,
            original_size_mb,
            original_codec,
            preset_id,
            status,
            progress,
            start_time,
            end_time,
            processing_started_ms,
            elapsed_ms,
            output_size_mb,
            input_path,
            created_time_ms,
            modified_time_ms,
            output_path,
            output_policy,
            ffmpeg_command,
            first_run_command,
            first_run_started_at_ms,
            skip_reason,
            media_info,
            estimated_seconds,
            preview_path,
            preview_revision,
            log_tail,
            failure_reason,
            warnings,
            batch_id,
            wait_metadata,
            ..
        } = job;

        let wait_metadata = wait_metadata.as_ref().map(WaitMetadataUiLite::from);

        Self {
            id,
            filename,
            job_type,
            source,
            queue_order,
            original_size_mb,
            original_codec,
            preset_id,
            status,
            wait_request_pending: false,
            progress,
            start_time,
            end_time,
            processing_started_ms,
            elapsed_ms,
            output_size_mb,
            input_path,
            created_time_ms,
            modified_time_ms,
            output_path,
            output_policy,
            ffmpeg_command,
            first_run_command,
            first_run_started_at_ms,
            skip_reason,
            media_info,
            estimated_seconds,
            preview_path,
            preview_revision,
            log_tail,
            failure_reason,
            warnings,
            batch_id,
            wait_metadata,
        }
    }
}

impl From<&TranscodeJobLite> for TranscodeJobUiLite {
    fn from(job: &TranscodeJobLite) -> Self {
        Self::from(job.clone())
    }
}

impl From<&TranscodeJob> for TranscodeJobUiLite {
    fn from(job: &TranscodeJob) -> Self {
        Self::from(TranscodeJobLite::from(job))
    }
}

impl From<&QueueStateLite> for QueueStateUiLite {
    fn from(snapshot: &QueueStateLite) -> Self {
        Self {
            snapshot_revision: snapshot.snapshot_revision,
            jobs: snapshot.jobs.iter().map(TranscodeJobUiLite::from).collect(),
        }
    }
}

#[cfg(test)]
mod ui_lite_tests {
    use super::*;

    #[test]
    fn queue_state_ui_lite_omits_recovery_only_fields() {
        let job = TranscodeJobLite {
            id: "job-1".to_string(),
            filename: "C:/videos/in.mp4".to_string(),
            job_type: JobType::Video,
            source: JobSource::Manual,
            queue_order: Some(1),
            original_size_mb: 10.0,
            original_codec: Some("h264".to_string()),
            preset_id: "preset-1".to_string(),
            status: JobStatus::Paused,
            progress: 40.0,
            start_time: Some(123),
            end_time: None,
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: None,
            input_path: Some("C:/videos/in.mp4".to_string()),
            created_time_ms: None,
            modified_time_ms: None,
            output_path: Some("C:/videos/out.mp4".to_string()),
            output_policy: None,
            ffmpeg_command: Some("ffmpeg -i in out".to_string()),
            first_run_command: None,
            first_run_started_at_ms: None,
            skip_reason: None,
            media_info: None,
            estimated_seconds: None,
            preview_path: None,
            preview_revision: 0,
            log_tail: None,
            log_head: Some(vec!["ffmpeg version ...".to_string()]),
            failure_reason: None,
            warnings: Vec::new(),
            batch_id: None,
            wait_metadata: Some(WaitMetadata {
                last_progress_percent: Some(40.0),
                processed_wall_millis: Some(1234),
                processed_seconds: Some(12.5),
                target_seconds: Some(25.0),
                progress_epoch: Some(3),
                last_progress_out_time_seconds: Some(12.5),
                last_progress_speed: Some(1.75),
                last_progress_updated_at_ms: Some(1712345678901),
                last_progress_frame: Some(12345),
                tmp_output_path: Some("C:/tmp/seg0.mkv".to_string()),
                segments: Some(vec!["C:/tmp/seg0.mkv".to_string()]),
                segment_end_targets: Some(vec![12.5]),
            }),
        };

        let snapshot = QueueStateLite {
            snapshot_revision: 7,
            jobs: vec![job],
        };

        let ui = QueueStateUiLite::from(&snapshot);
        let json = serde_json::to_value(&ui).expect("serialize ui lite");

        let job_json = &json["jobs"][0];
        assert!(job_json.get("logHead").is_none());
        assert_eq!(job_json["waitRequestPending"], false);

        let meta = &job_json["waitMetadata"];
        assert_eq!(meta["tmpOutputPath"], "C:/tmp/seg0.mkv");
        assert!(meta.get("segments").is_none());
        assert!(meta.get("segmentEndTargets").is_none());
    }
}
