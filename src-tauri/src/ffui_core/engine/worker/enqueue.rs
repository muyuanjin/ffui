use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use super::super::ffmpeg_args::{build_ffmpeg_args, format_command_for_log};
use super::super::output_policy_paths::plan_video_output_path;
use super::super::state::{Inner, notify_queue_listeners};
use super::super::worker_utils::{current_time_millis, estimate_job_seconds_for_preset};
use crate::ffui_core::domain::{
    JobSource, JobStatus, JobType, MediaInfo, OutputPolicy, TranscodeJob,
};
use crate::sync_ext::MutexExt;

fn normalize_os_path_string(raw: String) -> String {
    #[cfg(windows)]
    {
        let mut bytes = raw.into_bytes();
        for b in &mut bytes {
            if *b == b'/' {
                *b = b'\\';
            }
        }
        String::from_utf8(bytes).unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        raw
    }
}

fn enqueue_transcode_job_no_notify(
    inner: &Arc<Inner>,
    filename: String,
    job_type: JobType,
    source: JobSource,
    original_size_mb: f64,
    original_codec: Option<String>,
    preset_id: String,
) -> TranscodeJob {
    let id = {
        let next_id = inner.next_job_id.fetch_add(1, Ordering::Relaxed);
        format!("job-{next_id}")
    };

    let now_ms = current_time_millis();

    let normalized_filename = normalize_os_path_string(filename);
    let input_path = normalized_filename.clone();

    // Prefer a backend-derived size based on the actual file on disk; fall back
    // to the caller-provided value if metadata is unavailable.
    let computed_original_size_mb = fs::metadata(&normalized_filename)
        .map(|m| m.len() as f64 / (1024.0 * 1024.0))
        .unwrap_or(original_size_mb);

    let codec_for_job = original_codec.clone();

    {
        let mut state = inner.state.lock_unpoisoned();
        let preset = state.presets.iter().find(|p| p.id == preset_id).cloned();
        let estimated_seconds = preset
            .as_ref()
            .and_then(|p| estimate_job_seconds_for_preset(computed_original_size_mb, p));
        let queue_output_policy: OutputPolicy = state.settings.queue_output_policy.clone();
        let (output_path, warnings) = if matches!(job_type, JobType::Video) {
            let path = PathBuf::from(&normalized_filename);
            let plan =
                plan_video_output_path(&path, preset.as_ref(), &queue_output_policy, |candidate| {
                    let c = candidate.to_string_lossy();
                    state
                        .jobs
                        .values()
                        .any(|j| j.output_path.as_deref() == Some(c.as_ref()))
                        || state.known_batch_compress_outputs.contains(c.as_ref())
                });
            (
                Some(plan.output_path.to_string_lossy().into_owned()),
                plan.warnings,
            )
        } else {
            (None, Vec::new())
        };

        let planned_command = if matches!(job_type, JobType::Video) {
            match (preset.as_ref(), output_path.as_deref()) {
                (Some(preset), Some(output_path)) => {
                    let input_path_buf = PathBuf::from(&normalized_filename);
                    let output_path_buf = PathBuf::from(output_path);
                    let args = build_ffmpeg_args(
                        preset,
                        &input_path_buf,
                        &output_path_buf,
                        false,
                        Some(&queue_output_policy),
                    );
                    Some(format_command_for_log("ffmpeg", &args))
                }
                _ => None,
            }
        } else {
            None
        };

        let mut logs: Vec<String> = Vec::new();
        for w in &warnings {
            logs.push(format!("warning: {}", w.message));
        }

        let job = TranscodeJob {
            id: id.clone(),
            filename: normalized_filename,
            job_type,
            source,
            queue_order: None,
            original_size_mb: computed_original_size_mb,
            original_codec: codec_for_job,
            preset_id,
            status: JobStatus::Queued,
            progress: 0.0,
            start_time: Some(now_ms),
            end_time: None,
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: None,
            logs,
            log_head: None,
            skip_reason: None,
            input_path: Some(input_path),
            output_path,
            output_policy: Some(queue_output_policy),
            ffmpeg_command: planned_command,
            runs: Vec::new(),
            media_info: Some(MediaInfo {
                duration_seconds: None,
                width: None,
                height: None,
                frame_rate: None,
                video_codec: original_codec,
                audio_codec: None,
                size_mb: Some(computed_original_size_mb),
            }),
            estimated_seconds,
            preview_path: None,
            preview_revision: 0,
            log_tail: None,
            failure_reason: None,
            warnings,
            batch_id: None,
            wait_metadata: None,
        };
        state.queue.push_back(id.clone());
        state.jobs.insert(id, job.clone());
        job
    }
}

/// Enqueue a new transcode job with computed metadata and queue it.
pub(in crate::ffui_core::engine) fn enqueue_transcode_job(
    inner: &Arc<Inner>,
    filename: String,
    job_type: JobType,
    source: JobSource,
    original_size_mb: f64,
    original_codec: Option<String>,
    preset_id: String,
) -> TranscodeJob {
    let job = enqueue_transcode_job_no_notify(
        inner,
        filename,
        job_type,
        source,
        original_size_mb,
        original_codec,
        preset_id,
    );
    // Wake all waiting workers: enqueueing can add many jobs at once and we want
    // the concurrency limit to be reached immediately (not only after the first
    // job completes and calls notify_all()).
    inner.cv.notify_all();
    notify_queue_listeners(inner);
    job
}

/// Enqueue multiple jobs in a single batch and notify queue listeners once.
pub(in crate::ffui_core::engine) fn enqueue_transcode_jobs(
    inner: &Arc<Inner>,
    filenames: Vec<String>,
    job_type: JobType,
    source: JobSource,
    original_size_mb: f64,
    original_codec: Option<String>,
    preset_id: String,
) -> Vec<TranscodeJob> {
    if filenames.is_empty() {
        return Vec::new();
    }

    let mut jobs = Vec::with_capacity(filenames.len());
    for filename in filenames {
        let job = enqueue_transcode_job_no_notify(
            inner,
            filename,
            job_type,
            source,
            original_size_mb,
            original_codec.clone(),
            preset_id.clone(),
        );
        jobs.push(job);
    }

    // See enqueue_transcode_job(): reach concurrency immediately after bulk enqueue.
    inner.cv.notify_all();
    notify_queue_listeners(inner);
    jobs
}
