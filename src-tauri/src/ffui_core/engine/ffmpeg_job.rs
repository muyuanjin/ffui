use std::fs;
use std::path::Path;
use std::process::ExitStatus;

use anyhow::{Context, Result};
use tempfile::TempPath;

use crate::ffui_core::domain::{FfmpegInvocation, FfmpegOutput, JobStatus, WaitMetadata};
use crate::ffui_core::tools::{ExternalToolKind, ensure_tool_available};
use crate::sync_ext::MutexExt;

use super::state::{Inner, notify_queue_listeners};
use super::worker_utils::{append_job_log_line, current_time_millis};

mod process;

struct ManagedTemporary {
    path: TempPath,
    file_times: Option<super::file_times::FileTimesSnapshot>,
}

fn current_attempt(job: &crate::ffui_core::domain::TranscodeJob, attempt: usize) -> bool {
    job.status == JobStatus::Processing && job.runs.len() == attempt
}

pub(super) fn process_ffmpeg_job(
    inner: &Inner,
    job_id: &str,
    invocation: FfmpegInvocation,
) -> Result<()> {
    let settings = inner.state.lock_unpoisoned().settings.clone();
    let initial_job = inner.state.lock_unpoisoned().jobs.get(job_id).cloned();
    let mut temporary = None;
    let mut attempt = initial_job.as_ref().map_or(0, |job| job.runs.len());
    let result = (|| {
        super::manual_execution::validate_invocation(&invocation).map_err(anyhow::Error::msg)?;
        if let Some(job) = &initial_job {
            for path in super::worker::collect_job_tmp_cleanup_paths(job) {
                if path.exists() {
                    fs::remove_file(path)
                        .context("failed to remove previous owned temporary output")?;
                }
            }
        }
        let (program, _, downloaded) =
            ensure_tool_available(ExternalToolKind::Ffmpeg, &settings.tools)?;
        if downloaded {
            super::job_runner::record_tool_download_with_inner(
                inner,
                ExternalToolKind::Ffmpeg,
                &program,
            );
        }
        let mut args = invocation.args.clone();
        if let FfmpegOutput::ManagedFile {
            path,
            argument_index,
        } = &invocation.output
        {
            let output = Path::new(path);
            let parent = output
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or(Path::new("."));
            fs::create_dir_all(parent).context("failed to create output directory")?;
            let suffix = format!(
                ".tmp.{}",
                output
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("bin")
            );
            let temp = tempfile::Builder::new()
                .prefix(&format!(".ffui-{job_id}-"))
                .suffix(&suffix)
                .tempfile_in(parent)
                .context("failed to reserve managed temporary output")?
                .into_temp_path();
            args[*argument_index as usize] = temp.to_string_lossy().into_owned();
            args.retain(|argument| argument != "-y" && argument != "-n");
            args.insert(0, "-y".to_string());
            let file_times = initial_job.as_ref().and_then(|job| {
                let input = job.input_path.as_deref()?;
                let policy = job.output_policy.as_ref()?;
                super::job_runner::input_file_times_for_policy(
                    &policy.preserve_file_times,
                    Path::new(input),
                )
            });
            temporary = Some(ManagedTemporary {
                path: temp,
                file_times,
            });
        }
        super::job_runner::log_external_command(inner, job_id, &program, &args);
        {
            let mut state = inner.state.lock_unpoisoned();
            let job = state
                .jobs
                .get_mut(job_id)
                .context("command job disappeared before execution")?;
            attempt = job.runs.len();
            job.progress = 0.0;
            job.wait_metadata = Some(WaitMetadata {
                last_progress_percent: None,
                processed_wall_millis: job.elapsed_ms,
                processed_seconds: None,
                target_seconds: None,
                progress_epoch: Some(attempt as u64),
                last_progress_out_time_seconds: None,
                last_progress_speed: None,
                last_progress_updated_at_ms: None,
                last_progress_frame: None,
                tmp_output_path: temporary
                    .as_ref()
                    .map(|temporary| temporary.path.to_string_lossy().into_owned()),
                segments: None,
                segment_end_targets: None,
            });
        }
        notify_queue_listeners(inner);
        process::run(
            &program,
            &invocation,
            &args,
            || {
                let state = inner.state.lock_unpoisoned();
                state.cancelled_jobs.contains(job_id)
                    || state.wait_requests.contains(job_id)
                    || !state
                        .jobs
                        .get(job_id)
                        .is_some_and(|job| current_attempt(job, attempt))
            },
            |line| record_line(inner, job_id, attempt, line),
        )
    })();
    finish_run(
        inner,
        job_id,
        attempt,
        &invocation.output,
        temporary,
        result,
    );
    notify_queue_listeners(inner);
    Ok(())
}

fn record_line(inner: &Inner, job_id: &str, attempt: usize, line: &str) {
    super::job_runner::update_ffmpeg_job_progress(inner, job_id, attempt, line);
}

fn finish_run(
    inner: &Inner,
    job_id: &str,
    attempt: usize,
    output: &FfmpegOutput,
    temporary: Option<ManagedTemporary>,
    result: Result<ExitStatus>,
) {
    let mut state = inner.state.lock_unpoisoned();
    if !state
        .jobs
        .get(job_id)
        .is_some_and(|job| current_attempt(job, attempt))
    {
        return;
    }
    let restart = state.restart_requests.remove(job_id);
    let cancelled = state.cancelled_jobs.remove(job_id);
    let waited = state.wait_requests.remove(job_id);
    let job = state.jobs.get_mut(job_id).expect("checked command job");
    let now = current_time_millis();
    let wall_baseline = job
        .wait_metadata
        .as_ref()
        .and_then(|meta| meta.processed_wall_millis)
        .unwrap_or(0);
    job.elapsed_ms = Some(
        wall_baseline.saturating_add(now.saturating_sub(job.processing_started_ms.unwrap_or(now))),
    );
    job.processing_started_ms = None;
    if attempt != 0 {
        job.wait_metadata = None;
    }
    job.failure_reason = None;
    if restart {
        job.status = JobStatus::Queued;
        job.progress = 0.0;
        job.end_time = None;
        append_job_log_line(
            job,
            "Restart requested; command will re-run from the beginning".to_string(),
        );
        if !state.queue.iter().any(|id| id == job_id) {
            state.queue.push_back(job_id.to_string());
        }
        return;
    }
    if cancelled || waited {
        job.status = if cancelled {
            JobStatus::Cancelled
        } else {
            JobStatus::Paused
        };
        job.progress = 0.0;
        job.end_time = cancelled.then_some(now);
        append_job_log_line(
            job,
            if cancelled {
                "Command cancelled"
            } else {
                "Command stopped; no resumable checkpoint was retained"
            }
            .to_string(),
        );
        return;
    }
    let published = result.and_then(|status| {
        if !status.success() {
            anyhow::bail!(
                "FFmpeg exited with {status}: {}",
                job.log_tail.as_deref().unwrap_or("see command logs")
            );
        }
        match (output, temporary) {
            (FfmpegOutput::Transparent, _) => Ok(None),
            (FfmpegOutput::ManagedFile { path, .. }, Some(temp)) => {
                let size = fs::metadata(&temp.path)
                    .context("managed output is missing")?
                    .len();
                if size == 0 {
                    anyhow::bail!("FFmpeg produced an empty managed output");
                }
                if let Some(times) = &temp.file_times
                    && let Err(reason) = super::file_times::apply_file_times(&temp.path, times)
                {
                    append_job_log_line(
                        job,
                        format!("warning: failed to preserve file timestamps: {reason}"),
                    );
                }
                temp.path.persist_noclobber(path).map_err(|error| {
                    anyhow::anyhow!(
                        "failed to publish managed output without overwriting: {}",
                        error.error
                    )
                })?;
                Ok(Some(size as f64 / (1024.0 * 1024.0)))
            }
            _ => anyhow::bail!("managed output reservation was lost"),
        }
    });
    job.end_time = Some(now);
    job.progress = 100.0;
    match published {
        Ok(size) => {
            job.status = JobStatus::Completed;
            job.output_size_mb = size;
        }
        Err(error) => {
            job.status = JobStatus::Failed;
            let reason = format!("FFmpeg command failed: {error:#}");
            job.failure_reason = Some(reason.clone());
            append_job_log_line(job, reason);
        }
    }
}

pub(super) fn mark_invalid_job(inner: &Inner, job_id: &str, reason: String) {
    let mut state = inner.state.lock_unpoisoned();
    if let Some(job) = state.jobs.get_mut(job_id) {
        job.status = JobStatus::Failed;
        job.progress = 100.0;
        job.end_time = Some(current_time_millis());
        job.failure_reason = Some(reason.clone());
        append_job_log_line(job, reason);
    }
}

#[cfg(test)]
mod tests;
