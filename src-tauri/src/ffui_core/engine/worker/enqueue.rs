use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;

use super::super::ffmpeg_args::{build_ffmpeg_run_plan, format_command_for_log};
use super::super::output_policy_paths::plan_video_output_path;
use super::super::state::{Inner, notify_queue_listeners};
use super::super::worker_utils::{current_time_millis, estimate_job_seconds_for_preset};
use crate::ffui_core::domain::{
    FfmpegInvocation, FfmpegJobRequest, FfmpegOutput, JobExecution, JobLogLine, JobRequest,
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
    request: JobRequest,
    explicit_execution: Option<JobExecution>,
) -> TranscodeJob {
    let JobRequest {
        filename,
        mut job_type,
        source,
        original_size_mb,
        original_codec,
        preset_id,
    } = request;
    let direct_command = explicit_execution.is_some();
    let id = {
        let next_id = inner.next_job_id.fetch_add(1, Ordering::Relaxed);
        format!("job-{next_id}")
    };

    let now_ms = current_time_millis();

    let normalized_filename = if direct_command {
        filename
    } else {
        normalize_os_path_string(filename)
    };
    let mut path_error = None;
    let input_path = if matches!(source, JobSource::Manual) && !direct_command {
        match std::path::absolute(&normalized_filename) {
            Ok(path) => path.to_string_lossy().into_owned(),
            Err(error) => {
                path_error = Some(format!("Cannot resolve input file address: {error}"));
                normalized_filename.clone()
            }
        }
    } else {
        normalized_filename.clone()
    };
    if matches!(source, JobSource::Manual) && !direct_command {
        job_type = super::super::manual_execution::presentation_type(Path::new(&input_path));
    }

    // Prefer a backend-derived size based on the actual file on disk; fall back
    // to the caller-provided value if metadata is unavailable.
    let computed_original_size_mb = fs::metadata(&input_path)
        .map(|m| m.len() as f64 / (1024.0 * 1024.0))
        .unwrap_or(original_size_mb);

    let input_times = super::super::file_times::read_file_times(Path::new(&input_path));
    let created_time_ms = input_times
        .created
        .and_then(super::super::file_times::system_time_to_epoch_ms);
    let modified_time_ms = input_times
        .modified
        .and_then(super::super::file_times::system_time_to_epoch_ms);

    let codec_for_job = original_codec.clone();

    {
        let mut state = inner.state.lock_unpoisoned();
        let preset = state.presets.iter().find(|p| p.id == preset_id).cloned();
        let estimated_seconds = preset
            .as_ref()
            .and_then(|p| estimate_job_seconds_for_preset(computed_original_size_mb, p));
        let queue_output_policy: OutputPolicy = state.settings.queue_output_policy.clone();
        let (mut output_path, warnings) = if !direct_command
            && (matches!(source, JobSource::Manual) || matches!(job_type, JobType::Video))
        {
            let path = PathBuf::from(&input_path);
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

        if matches!(source, JobSource::Manual)
            && !direct_command
            && let Some(path) = &output_path
        {
            match std::path::absolute(path) {
                Ok(path) => output_path = Some(path.to_string_lossy().into_owned()),
                Err(error) => {
                    path_error = Some(format!("Cannot resolve output file address: {error}"))
                }
            }
        }
        let execution = if direct_command {
            explicit_execution
        } else if let Some(reason) = path_error {
            Some(JobExecution::Invalid { reason })
        } else if matches!(source, JobSource::Manual) {
            Some(match (preset.as_ref(), output_path.as_deref()) {
                (Some(preset), Some(output)) => {
                    super::super::manual_execution::plan_manual_execution(
                        Path::new(&input_path),
                        preset,
                        Path::new(output),
                        &queue_output_policy,
                    )
                    .unwrap_or_else(|reason| JobExecution::Invalid { reason })
                }
                _ => JobExecution::Invalid {
                    reason: format!("No preset found for preset id '{preset_id}'"),
                },
            })
        } else {
            None
        };
        let estimated_seconds = if matches!(
            execution,
            Some(JobExecution::Ffmpeg { .. } | JobExecution::Invalid { .. })
        ) {
            None
        } else {
            estimated_seconds
        };
        let planned_command = if let Some(JobExecution::Ffmpeg { invocation }) = &execution {
            Some(format_command_for_log("ffmpeg", &invocation.args))
        } else if matches!(job_type, JobType::Video) {
            match (preset.as_ref(), output_path.as_deref()) {
                (Some(preset), Some(output_path)) => {
                    let input_path_buf = PathBuf::from(&normalized_filename);
                    let output_path_buf = PathBuf::from(output_path);
                    match build_ffmpeg_run_plan(
                        preset,
                        &input_path_buf,
                        &output_path_buf,
                        false,
                        Some(&queue_output_policy),
                    ) {
                        Ok(plan) => Some(
                            plan.iter()
                                .map(|run| format_command_for_log("ffmpeg", &run.args))
                                .collect::<Vec<_>>()
                                .join(" && "),
                        ),
                        Err(_) => None,
                    }
                }
                _ => None,
            }
        } else {
            None
        };
        if matches!(execution.as_ref(), Some(JobExecution::Ffmpeg { invocation })
            if matches!(invocation.output, FfmpegOutput::Transparent))
        {
            output_path = None;
        }

        let mut logs: Vec<JobLogLine> = Vec::new();
        for w in &warnings {
            logs.push(JobLogLine {
                text: format!("warning: {}", w.message),
                at_ms: Some(now_ms),
            });
        }

        let job = TranscodeJob {
            execution,
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
            input_path: (!direct_command).then_some(input_path),
            created_time_ms,
            modified_time_ms,
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
                audio: None,
                size_mb: Some(computed_original_size_mb),
            }),
            estimated_seconds,
            preview_path: None,
            preview_revision: 0,
            log_tail: None,
            failure_reason: None,
            warnings,
            batch_id: None,
            batch_compress_saving_condition: None,
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
        JobRequest {
            filename,
            job_type,
            source,
            original_size_mb,
            original_codec,
            preset_id,
        },
        None,
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
            JobRequest {
                filename,
                job_type,
                source,
                original_size_mb,
                original_codec: original_codec.clone(),
                preset_id: preset_id.clone(),
            },
            None,
        );
        jobs.push(job);
    }

    // See enqueue_transcode_job(): reach concurrency immediately after bulk enqueue.
    inner.cv.notify_all();
    notify_queue_listeners(inner);
    jobs
}

pub(in crate::ffui_core::engine) fn enqueue_ffmpeg_job(
    inner: &Arc<Inner>,
    request: FfmpegJobRequest,
) -> Result<TranscodeJob, String> {
    if request.name.trim().is_empty() || request.name.contains('\0') {
        return Err("Command job name must be non-empty and contain no NUL".to_string());
    }
    let invocation = FfmpegInvocation {
        args: request.args,
        working_directory: request.working_directory,
        progress: None,
        output: FfmpegOutput::Transparent,
    };
    super::super::manual_execution::validate_invocation(&invocation)?;
    let job = enqueue_transcode_job_no_notify(
        inner,
        JobRequest {
            filename: request.name,
            job_type: JobType::Other,
            source: JobSource::Manual,
            original_size_mb: 0.0,
            original_codec: None,
            preset_id: String::new(),
        },
        Some(JobExecution::Ffmpeg { invocation }),
    );
    inner.cv.notify_all();
    notify_queue_listeners(inner);
    Ok(job)
}
