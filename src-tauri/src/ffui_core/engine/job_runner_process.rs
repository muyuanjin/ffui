// ============================================================================
// Core job processing
// ============================================================================

use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::domain::{
    BatchCompressConfig, BatchCompressSavingCondition, FFmpegPreset, OutputPolicy,
};
use crate::ffui_core::engine::state::BatchCompressBatch;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ResumeStrategy {
    LegacySeek,
    OverlapTrim,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct ResumePlan {
    pub(super) target_seconds: f64,
    pub(super) seek_seconds: f64,
    pub(super) trim_start_seconds: f64,
    pub(super) trim_at_seconds: f64,
    pub(super) backtrack_seconds: f64,
    pub(super) strategy: ResumeStrategy,
}

/// Prepared snapshot and configuration for a single transcode job.
///
/// This structure collects all values that need to flow from the initial
/// queue/state inspection phase into the long-running ffmpeg execution phase.
struct PreparedTranscodeJob {
    input_path: PathBuf,
    settings_snapshot: AppSettings,
    preset: FFmpegPreset,
    finalize_preset: FFmpegPreset,
    original_size_bytes: u64,
    preset_id: String,
    output_path: PathBuf,
    resume_target_seconds: Option<f64>,
    resume_plan: Option<ResumePlan>,
    finalize_with_source_audio: bool,
    // Partial output segments accumulated across previous pauses. When this
    // vector is non-empty,本次运行会在成功完成后将这些分段与当前 tmp_output
    // 生成的最新分段一起 concat 为最终输出。
    existing_segments: Vec<PathBuf>,
    // Join target end times (seconds) for each completed segment in
    // `existing_segments`. Length SHOULD equal `existing_segments.len()` when
    // available; used to build concat lists with explicit durations.
    segment_end_targets: Vec<f64>,
    tmp_output: PathBuf,
    total_duration: Option<f64>,
    ffmpeg_path: String,
    ffmpeg_source: String,
}

struct PreparedBatchCompressMediaJob {
    path: PathBuf,
    config: BatchCompressConfig,
    settings_snapshot: AppSettings,
    presets: std::sync::Arc<Vec<FFmpegPreset>>,
    batch_id: String,
    job_type: JobType,
}

pub(super) fn process_transcode_job(inner: &Inner, job_id: &str) -> Result<()> {
    let dispatch = {
        let state = inner.state.lock_unpoisoned();
        state
            .jobs
            .get(job_id)
            .map(|job| (job.job_type, job.source))
    };

    match dispatch {
        Some((JobType::Image | JobType::Audio, JobSource::BatchCompress)) => {
            return process_batch_compress_media_job(inner, job_id);
        }
        Some((JobType::Image | JobType::Audio, JobSource::Manual)) => {
            mark_unsupported_manual_media_job(inner, job_id);
            return Ok(());
        }
        _ => {}
    }

    // Phase 1: inspect queue state, resolve preset/paths, and persist media
    // metadata plus preview paths back into the job. When the job does not
    // require processing (non-video or missing preset) this returns Ok(None)
    // after updating the job state accordingly.
    let Some(prepared) = prepare_transcode_job(inner, job_id)? else {
        return Ok(());
    };

    // Phase 2: run ffmpeg, stream progress/logs, handle cooperative
    // wait/cancel, and finalize statistics/output files.
    execute_transcode_job(inner, job_id, prepared)
}

fn process_batch_compress_media_job(inner: &Inner, job_id: &str) -> Result<()> {
    let prepared = match prepare_batch_compress_media_job(inner, job_id) {
        Ok(Some(prepared)) => prepared,
        Ok(None) => return Ok(()),
        Err(err) => {
            mark_batch_compress_media_failed(inner, job_id, err);
            mark_batch_compress_child_processed(inner, job_id);
            return Ok(());
        }
    };

    let result = match prepared.job_type {
        JobType::Image => super::batch_compress::handle_image_file_with_id(
            inner,
            &prepared.path,
            &prepared.config,
            &prepared.settings_snapshot,
            &prepared.batch_id,
            Some(job_id.to_string()),
        ),
        JobType::Audio => super::batch_compress::handle_audio_file_with_id(
            inner,
            &prepared.path,
            &prepared.config,
            &prepared.settings_snapshot,
            prepared.presets.as_ref(),
            &prepared.batch_id,
            Some(job_id.to_string()),
        ),
        JobType::Video => unreachable!("video jobs use the transcode path"),
    };

    match result {
        Ok(job) => {
            store_batch_compress_media_result(inner, job_id, job);
        }
        Err(err) => {
            mark_batch_compress_media_failed(inner, job_id, err);
        }
    }
    mark_batch_compress_child_processed(inner, job_id);
    Ok(())
}

fn prepare_batch_compress_media_job(
    inner: &Inner,
    job_id: &str,
) -> Result<Option<PreparedBatchCompressMediaJob>> {
    let state = inner.state.lock_unpoisoned();
    let Some(job) = state.jobs.get(job_id) else {
        return Ok(None);
    };
    let Some(batch_id) = job.batch_id.clone() else {
        return Ok(None);
    };
    let batch = state.batch_compress_batches.get(&batch_id).cloned();

    // Prefer runtime batch metadata, but restored queues only have the job snapshot.
    let input_path = job
        .input_path
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| job.filename.clone());
    let saving = if let Some(saving) = job.batch_compress_saving_condition {
        saving
    } else if let Some(batch) = batch.as_ref() {
        BatchCompressSavingCondition {
            saving_condition_type: batch.saving_condition_type,
            min_saving_ratio: batch.min_saving_ratio,
            min_saving_absolute_mb: batch.min_saving_absolute_mb,
            min_image_size_kb: Some(batch.min_image_size_kb),
            min_audio_size_kb: Some(batch.min_audio_size_kb),
            image_target_format: Some(batch.image_target_format),
            replace_original: Some(batch.replace_original),
        }
    } else {
        return Err(anyhow::anyhow!(
            "restored Batch Compress media job is missing persisted compression settings"
        ));
    };

    if batch.is_none() && !saving.has_complete_media_snapshot() {
        return Err(anyhow::anyhow!(
            "restored Batch Compress media job is missing complete persisted compression settings"
        ));
    }

    let output_policy = job
        .output_policy
        .clone()
        .or_else(|| batch.as_ref().map(|batch| batch.output_policy.clone()));
    if batch.is_none() && output_policy.is_none() {
        return Err(anyhow::anyhow!(
            "restored Batch Compress media job is missing persisted output policy"
        ));
    }
    let mut output_policy = output_policy.unwrap_or_default();

    let replace_original = batch
        .as_ref()
        .map_or(saving.replace_original.unwrap_or(false), |batch| {
            batch.replace_original
        });
    if replace_original {
        let config_for_policy = batch_media_config_from_snapshot(
            batch.as_ref(),
            saving,
            String::new(),
            None,
            output_policy,
        );
        output_policy = super::batch_compress::replace_original_output_policy(&config_for_policy);
    }

    let audio_preset_id = if job.job_type == JobType::Audio && !job.preset_id.is_empty() {
        Some(job.preset_id.clone())
    } else {
        None
    };
    let config = batch_media_config_from_snapshot(
        batch.as_ref(),
        saving,
        job.preset_id.clone(),
        audio_preset_id,
        output_policy,
    );
    let settings_snapshot = state.settings.clone();
    let presets = state.presets.clone();
    let job_type = job.job_type;

    Ok(Some(PreparedBatchCompressMediaJob {
        path: PathBuf::from(input_path),
        config,
        settings_snapshot,
        presets,
        batch_id,
        job_type,
    }))
}

trait BatchCompressSavingConditionSnapshotExt {
    fn has_complete_media_snapshot(&self) -> bool;
}

impl BatchCompressSavingConditionSnapshotExt for BatchCompressSavingCondition {
    fn has_complete_media_snapshot(&self) -> bool {
        self.min_image_size_kb.is_some()
            && self.min_audio_size_kb.is_some()
            && self.image_target_format.is_some()
            && self.replace_original.is_some()
    }
}

fn batch_media_config_from_snapshot(
    batch: Option<&BatchCompressBatch>,
    saving: BatchCompressSavingCondition,
    video_preset_id: String,
    audio_preset_id: Option<String>,
    output_policy: OutputPolicy,
) -> BatchCompressConfig {
    BatchCompressConfig {
        root_path: batch.map(|batch| batch.root_path.clone()),
        replace_original: batch.map_or(saving.replace_original.unwrap_or(false), |batch| {
            batch.replace_original
        }),
        min_image_size_kb: batch
            .map(|batch| batch.min_image_size_kb)
            .or(saving.min_image_size_kb)
            .unwrap_or(0),
        min_video_size_mb: 0,
        min_audio_size_kb: batch
            .map(|batch| batch.min_audio_size_kb)
            .or(saving.min_audio_size_kb)
            .unwrap_or(0),
        saving_condition_type: saving.saving_condition_type,
        min_saving_ratio: saving.min_saving_ratio,
        min_saving_absolute_mb: saving.min_saving_absolute_mb,
        image_target_format: batch
            .map(|batch| batch.image_target_format)
            .or(saving.image_target_format)
            .unwrap_or_default(),
        video_preset_id,
        audio_preset_id,
        video_filter: Default::default(),
        image_filter: Default::default(),
        audio_filter: Default::default(),
        output_policy,
    }
}

fn store_batch_compress_media_result(
    inner: &Inner,
    job_id: &str,
    mut next_job: crate::ffui_core::domain::TranscodeJob,
) {
    let should_wake_worker = {
        let mut state = inner.state.lock_unpoisoned();
        let wait_requested = state.wait_requests.contains(job_id);
        let cancel_requested = state.cancelled_jobs.contains(job_id);
        let restart_after_cancel = state.restart_requests.remove(job_id);
        if restart_after_cancel {
            state.wait_requests.remove(job_id);
            state.cancelled_jobs.remove(job_id);
            if matches!(next_job.status, JobStatus::Completed) {
                next_job.wait_metadata = None;
                state.queue.retain(|id| id != job_id);
                super::worker_utils::append_job_log_line(
                    &mut next_job,
                    "Restart request arrived after Batch Compress media child finalized; keeping finalized output"
                        .to_string(),
                );
            } else {
                next_job.status = JobStatus::Queued;
                next_job.progress = 0.0;
                next_job.end_time = None;
                next_job.failure_reason = None;
                next_job.skip_reason = None;
                next_job.wait_metadata = None;
                super::worker_utils::append_job_log_line(
                    &mut next_job,
                    "Restart requested from UI; job will re-run from 0%".to_string(),
                );
                if !state.queue.iter().any(|id| id == job_id) {
                    state.queue.push_back(job_id.to_string());
                }
            }
        } else if cancel_requested
            && matches!(next_job.status, JobStatus::Paused | JobStatus::Cancelled)
        {
            state.wait_requests.remove(job_id);
            state.cancelled_jobs.remove(job_id);
            next_job.status = JobStatus::Cancelled;
            next_job.progress = 0.0;
            next_job.end_time = Some(current_time_millis());
            next_job.failure_reason = None;
            next_job.skip_reason = None;
            next_job.wait_metadata = None;
            state.queue.retain(|id| id != job_id);
            super::worker_utils::append_job_log_line(
                &mut next_job,
                "Cancelled by user".to_string(),
            );
        } else if wait_requested
            && matches!(next_job.status, JobStatus::Paused | JobStatus::Cancelled)
        {
            state.wait_requests.remove(job_id);
            let converted_from_cancelled = matches!(next_job.status, JobStatus::Cancelled);
            next_job.status = JobStatus::Paused;
            next_job.end_time = None;
            next_job.wait_metadata = None;
            if converted_from_cancelled {
                super::worker_utils::append_job_log_line(
                    &mut next_job,
                    "Paused while processing Batch Compress media child; resume will re-run from 0%"
                        .to_string(),
                );
            }
            if !state.queue.iter().any(|id| id == job_id) {
                state.queue.push_front(job_id.to_string());
            }
        } else if matches!(next_job.status, JobStatus::Paused) {
            state.wait_requests.remove(job_id);
            state.cancelled_jobs.remove(job_id);
            next_job.status = JobStatus::Queued;
            next_job.progress = 0.0;
            next_job.end_time = None;
            next_job.wait_metadata = None;
            super::worker_utils::append_job_log_line(
                &mut next_job,
                "Resume requested after Batch Compress media child stopped for wait; job will re-run from 0%"
                    .to_string(),
            );
            if !state.queue.iter().any(|id| id == job_id) {
                state.queue.push_back(job_id.to_string());
            }
        } else {
            state.wait_requests.remove(job_id);
            state.cancelled_jobs.remove(job_id);
        }
        state.jobs.insert(next_job.id.clone(), next_job);
        (restart_after_cancel
            && !matches!(
                state.jobs.get(job_id).map(|job| job.status),
                Some(JobStatus::Completed)
            ))
            || (!wait_requested
                && !cancel_requested
                && matches!(state.jobs.get(job_id).map(|job| job.status), Some(JobStatus::Queued)))
    };

    if should_wake_worker {
        inner.cv.notify_all();
    }
}

fn mark_batch_compress_media_failed(inner: &Inner, job_id: &str, err: anyhow::Error) {
    let should_wake_worker = {
        let mut state = inner.state.lock_unpoisoned();
        let restart_after_cancel = state.restart_requests.remove(job_id);
        let cancel_requested = state.cancelled_jobs.remove(job_id);
        state.wait_requests.remove(job_id);

        if let Some(job) = state.jobs.get_mut(job_id) {
            if restart_after_cancel {
                job.status = JobStatus::Queued;
                job.progress = 0.0;
                job.end_time = None;
                job.failure_reason = None;
                job.skip_reason = None;
                job.wait_metadata = None;
                super::worker_utils::append_job_log_line(
                    job,
                    "Restart requested from UI; job will re-run from 0%".to_string(),
                );
            } else if cancel_requested {
                job.status = JobStatus::Cancelled;
                job.progress = 0.0;
                job.end_time = Some(current_time_millis());
                job.failure_reason = None;
                job.wait_metadata = None;
                super::worker_utils::append_job_log_line(job, "Cancelled by user".to_string());
            } else {
                job.status = JobStatus::Failed;
                job.progress = 100.0;
                job.end_time = Some(current_time_millis());
                let reason = format!("Batch Compress media compression failed: {err:#}");
                job.failure_reason = Some(reason.clone());
                super::worker_utils::append_job_log_line(job, reason);
            }
        }

        if restart_after_cancel && !state.queue.iter().any(|id| id == job_id) {
            state.queue.push_back(job_id.to_string());
        }

        restart_after_cancel
    };

    if should_wake_worker {
        inner.cv.notify_all();
    }
}

fn mark_unsupported_manual_media_job(inner: &Inner, job_id: &str) {
    let mut state = inner.state.lock_unpoisoned();
    if let Some(job) = state.jobs.get_mut(job_id) {
        job.status = JobStatus::Failed;
        job.progress = 100.0;
        job.end_time = Some(current_time_millis());
        let reason = format!(
            "Manual {} queue execution is not supported",
            match job.job_type {
                JobType::Image => "image",
                JobType::Audio => "audio",
                JobType::Video => "video",
            }
        );
        job.failure_reason = Some(reason.clone());
        super::worker_utils::append_job_log_line(job, reason);
    }
}

#[cfg(test)]
fn capture_queue_lite_deltas_for_tests(
    inner: &Inner,
) -> std::sync::Arc<std::sync::Mutex<Vec<crate::ffui_core::QueueStateLiteDelta>>> {
    let deltas = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let deltas_clone = std::sync::Arc::clone(&deltas);
    let mut listeners = inner.queue_lite_delta_listeners.lock_unpoisoned();
    listeners.push(std::sync::Arc::new(move |delta| {
        deltas_clone.lock_unpoisoned().push(delta);
    }));
    deltas
}

include!("job_runner_process_resume_utils.rs");
include!("job_runner_process_execute_replace_original.rs");
include!("job_runner_process_execute_audio_sidecar.rs");
include!("job_runner_process_execute_batch_compress.rs");
include!("job_runner_process_execute_two_pass.rs");
include!("job_runner_process_execute_file_times.rs");
include!("job_runner_process_execute.rs");
include!("job_runner_process_execute_success_finalize.rs");
#[cfg(test)]
include!("job_runner_process_execute_success_finalize_tests.rs");
include!("job_runner_process_execute_finalize.rs");
include!("job_runner_process_execute_resume_support.rs");
include!("job_runner_process_prepare.rs");
include!("job_runner_process_prepare_resume.rs");
#[cfg(test)]
include!("job_runner_process_batch_media_snapshot_tests.rs");

#[cfg(test)]
mod resume_support_tests {
    use super::FfmpegStderrPump;

    #[test]
    fn stderr_pump_does_not_drop_lines_emitted_during_join() {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let join = std::thread::spawn(move || {
            tx.send("first".to_string()).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(30));
            tx.send("last".to_string()).unwrap();
        });

        let mut pump = FfmpegStderrPump {
            rx: Some(rx),
            join: Some(join),
        };

        let mut got = Vec::new();
        pump.drain_exit_bound_lines(|line| got.push(line));

        assert_eq!(got, vec!["first".to_string(), "last".to_string()]);
    }
}
