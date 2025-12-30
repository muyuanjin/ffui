use serde::{Deserialize, Serialize};

use super::job::{JobConfig, JobStatus, JobWarning, MediaInfo, WaitMetadata};
use super::job_lite::TranscodeJobLite;

#[allow(clippy::trivially_copy_pass_by_ref)]
const fn is_zero(v: &u64) -> bool {
    *v == 0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecordRuntime {
    pub status: JobStatus,
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
    pub log_head: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<JobWarning>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wait_metadata: Option<WaitMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub version: u32,
    pub id: String,
    #[serde(
        rename = "queueOrder",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub queue_order: Option<u64>,
    pub config: JobConfig,
    pub runtime: JobRecordRuntime,
}

impl JobRecord {
    pub const CURRENT_VERSION: u32 = 1;

    pub fn canonicalize_and_upgrade_for_persistence(&mut self) -> bool {
        let mut changed = false;

        if self.version != Self::CURRENT_VERSION {
            self.version = Self::CURRENT_VERSION;
            changed = true;
        }

        let has_first_run_cmd = self
            .runtime
            .first_run_command
            .as_deref()
            .is_some_and(|v| !v.trim().is_empty());
        let can_backfill_first_run = !matches!(self.runtime.status, JobStatus::Queued)
            && !has_first_run_cmd
            && self
                .runtime
                .ffmpeg_command
                .as_deref()
                .is_some_and(|v| !v.trim().is_empty());

        if can_backfill_first_run {
            self.runtime.first_run_command = self.runtime.ffmpeg_command.clone();
            if self.runtime.first_run_started_at_ms.is_none() {
                self.runtime.first_run_started_at_ms = self.runtime.start_time;
            }
            changed = true;
        } else if has_first_run_cmd
            && self.runtime.first_run_started_at_ms.is_none()
            && self.runtime.start_time.is_some()
        {
            self.runtime.first_run_started_at_ms = self.runtime.start_time;
            changed = true;
        }

        changed
    }
}

impl From<TranscodeJobLite> for JobRecord {
    fn from(job: TranscodeJobLite) -> Self {
        let config = JobConfig {
            filename: job.filename,
            job_type: job.job_type,
            source: job.source,
            original_size_mb: job.original_size_mb,
            original_codec: job.original_codec,
            preset_id: job.preset_id,
            input_path: job.input_path,
            created_time_ms: job.created_time_ms,
            modified_time_ms: job.modified_time_ms,
            output_path: job.output_path,
            output_policy: job.output_policy,
            batch_id: job.batch_id,
        };

        let runtime = JobRecordRuntime {
            status: job.status,
            progress: job.progress,
            start_time: job.start_time,
            end_time: job.end_time,
            processing_started_ms: job.processing_started_ms,
            elapsed_ms: job.elapsed_ms,
            output_size_mb: job.output_size_mb,
            ffmpeg_command: job.ffmpeg_command,
            first_run_command: job.first_run_command,
            first_run_started_at_ms: job.first_run_started_at_ms,
            skip_reason: job.skip_reason,
            media_info: job.media_info,
            estimated_seconds: job.estimated_seconds,
            preview_path: job.preview_path,
            preview_revision: job.preview_revision,
            log_tail: job.log_tail,
            log_head: job.log_head,
            failure_reason: job.failure_reason,
            warnings: job.warnings,
            wait_metadata: job.wait_metadata,
        };

        let mut record = Self {
            version: Self::CURRENT_VERSION,
            id: job.id,
            queue_order: job.queue_order,
            config,
            runtime,
        };
        record.canonicalize_and_upgrade_for_persistence();
        record
    }
}

impl From<JobRecord> for TranscodeJobLite {
    fn from(record: JobRecord) -> Self {
        let JobRecord {
            id,
            queue_order,
            config,
            runtime,
            ..
        } = record;

        let JobConfig {
            filename,
            job_type,
            source,
            original_size_mb,
            original_codec,
            preset_id,
            input_path,
            created_time_ms,
            modified_time_ms,
            output_path,
            output_policy,
            batch_id,
        } = config;

        let JobRecordRuntime {
            status,
            progress,
            start_time,
            end_time,
            processing_started_ms,
            elapsed_ms,
            output_size_mb,
            ffmpeg_command,
            first_run_command,
            first_run_started_at_ms,
            skip_reason,
            media_info,
            estimated_seconds,
            preview_path,
            preview_revision,
            log_tail,
            log_head,
            failure_reason,
            warnings,
            wait_metadata,
        } = runtime;

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
            log_head,
            failure_reason,
            warnings,
            batch_id,
            wait_metadata,
        }
    }
}
