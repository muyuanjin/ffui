use std::time::{
    SystemTime,
    UNIX_EPOCH,
};

use super::state::{
    BatchCompressBatchStatus,
    Inner,
    notify_batch_compress_listeners,
    notify_queue_listeners,
};
use crate::ffui_core::domain::{
    AutoCompressProgress,
    FFmpegPreset,
    JobRun,
    JobStatus,
    TranscodeJob,
};

pub(super) const MAX_LOG_TAIL_BYTES: usize = 64 * 1024;
pub(super) const MAX_LOG_LINES: usize = 500;

fn is_critical_log_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("error")
        || lower.contains("failed")
        || lower.contains("exited with")
        || lower.contains("invalid")
        || lower.trim_start().starts_with("command:")
}

fn ensure_job_run_for_logs(job: &mut TranscodeJob, started_at_ms: u64) {
    if !job.runs.is_empty() {
        return;
    }

    let command = job.ffmpeg_command.clone().unwrap_or_default();
    job.runs.push(JobRun {
        command,
        logs: Vec::new(),
        started_at_ms: Some(started_at_ms),
    });
}

fn sync_job_logs_with_runs_if_needed(job: &mut TranscodeJob) {
    let run_total: usize = job.runs.iter().map(|r| r.logs.len()).sum();
    if run_total == job.logs.len() {
        return;
    }

    let mut rebuilt: Vec<String> = Vec::with_capacity(run_total);
    for run in &job.runs {
        rebuilt.extend(run.logs.iter().cloned());
    }
    job.logs = rebuilt;
}

/// Returns the current time in milliseconds since UNIX epoch.
pub(super) fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Recompute the `log_tail` field of a job by joining all logs and truncating
/// to the last MAX_LOG_TAIL_BYTES characters if necessary.
pub(super) fn recompute_log_tail(job: &mut TranscodeJob) {
    if job.logs.is_empty() {
        job.log_tail = None;
        return;
    }

    let joined = job.logs.join("\n");
    if joined.len() > MAX_LOG_TAIL_BYTES {
        let start = joined.len().saturating_sub(MAX_LOG_TAIL_BYTES);
        job.log_tail = Some(joined[start..].to_string());
    } else {
        job.log_tail = Some(joined);
    }
}

/// Keep log lines bounded while preserving "critical" diagnostics.
///
/// This trims by removing the oldest non-critical lines across runs first,
/// keeping recent output while ensuring critical lines survive as long as
/// possible. When all remaining lines are critical, it drops the oldest.
pub(super) fn trim_job_logs_with_priority(job: &mut TranscodeJob) {
    if job.logs.len() <= MAX_LOG_LINES {
        return;
    }

    if job.runs.is_empty() && !job.logs.is_empty() {
        // Legacy/migrated job: attach existing flat logs to a single run so
        // future appends stay consistent.
        let command = job.ffmpeg_command.clone().unwrap_or_default();
        job.runs.push(JobRun {
            command,
            logs: job.logs.clone(),
            started_at_ms: job.start_time,
        });
    }

    // If the run logs drifted from the flat logs (should not happen after
    // migration), rebuild the flat view from runs before trimming.
    if !job.runs.is_empty() {
        sync_job_logs_with_runs_if_needed(job);
    }

    while job.logs.len() > MAX_LOG_LINES {
        let mut removed = false;
        let mut prefix = 0usize;

        for run in job.runs.iter_mut() {
            if run.logs.is_empty() {
                continue;
            }

            if let Some(local_idx) = run.logs.iter().position(|line| !is_critical_log_line(line)) {
                run.logs.remove(local_idx);
                job.logs.remove(prefix + local_idx);
                removed = true;
                break;
            }

            prefix = prefix.saturating_add(run.logs.len());
        }

        if removed {
            continue;
        }

        // All remaining lines are critical; drop the oldest available line.
        let prefix = 0usize;
        for run in job.runs.iter_mut() {
            if run.logs.is_empty() {
                continue;
            }
            run.logs.remove(0);
            job.logs.remove(prefix);
            removed = true;
            break;
        }

        if !removed {
            break;
        }
    }
}

pub(super) fn append_job_log_line(job: &mut TranscodeJob, line: impl Into<String>) {
    let now_ms = current_time_millis();
    ensure_job_run_for_logs(job, now_ms);

    let line = line.into();
    job.logs.push(line.clone());
    if let Some(run) = job.runs.last_mut() {
        run.logs.push(line);
    }

    trim_job_logs_with_priority(job);
    recompute_log_tail(job);
}

/// Estimate the expected duration in seconds for a job based on preset statistics.
pub(super) fn estimate_job_seconds_for_preset(size_mb: f64, preset: &FFmpegPreset) -> Option<f64> {
    if size_mb <= 0.0 {
        return None;
    }

    let stats = &preset.stats;
    if stats.total_input_size_mb <= 0.0 || stats.total_time_seconds <= 0.0 {
        return None;
    }

    let mut seconds_per_mb = stats.total_time_seconds / stats.total_input_size_mb;
    if !seconds_per_mb.is_finite() || seconds_per_mb <= 0.0 {
        return None;
    }

    use crate::ffui_core::domain::EncoderType;

    let mut factor = 1.0f64;

    match preset.video.encoder {
        EncoderType::LibSvtAv1 => {
            factor *= 1.5;
        }
        EncoderType::HevcNvenc => {
            factor *= 0.9;
        }
        _ => {}
    }

    let name_lower = preset.name.to_lowercase();
    if name_lower.contains("veryslow") {
        factor *= 2.0;
    } else if name_lower.contains("slow") {
        factor *= 1.5;
    } else if name_lower.contains("fast") {
        factor *= 0.8;
    } else if name_lower.contains("veryfast") || name_lower.contains("ultrafast") {
        factor *= 0.6;
    }

    seconds_per_mb *= factor;

    let estimated = size_mb * seconds_per_mb;
    if estimated.is_finite() && estimated > 0.0 {
        Some(estimated)
    } else {
        None
    }
}

/// Mark a Batch Compress child job as processed and update batch status if all
/// children are complete.
pub(super) fn mark_batch_compress_child_processed(inner: &Inner, job_id: &str) {
    let (batch_id_opt, progress_opt) = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get(job_id) {
            Some(job) => job.clone(),
            None => return,
        };

        let batch_id = match job.batch_id.clone() {
            Some(id) => id,
            None => return,
        };

        let batch = match state.batch_compress_batches.get_mut(&batch_id) {
            Some(b) => b,
            None => return,
        };

        if !matches!(
            job.status,
            JobStatus::Completed | JobStatus::Skipped | JobStatus::Failed | JobStatus::Cancelled
        ) {
            return;
        }

        batch.total_processed = batch.total_processed.saturating_add(1);
        if batch.total_processed >= batch.total_candidates
            && !matches!(
                batch.status,
                BatchCompressBatchStatus::Completed | BatchCompressBatchStatus::Failed
            )
        {
            batch.status = BatchCompressBatchStatus::Completed;
            batch.completed_at_ms = Some(current_time_millis());
            (
                Some(batch_id.clone()),
                Some(AutoCompressProgress {
                    root_path: batch.root_path.clone(),
                    total_files_scanned: batch.total_files_scanned,
                    total_candidates: batch.total_candidates,
                    total_processed: batch.total_processed,
                    batch_id: batch.batch_id.clone(),
                    completed_at_ms: batch.completed_at_ms.unwrap_or(0),
                }),
            )
        } else {
            (
                None,
                Some(AutoCompressProgress {
                    root_path: batch.root_path.clone(),
                    total_files_scanned: batch.total_files_scanned,
                    total_candidates: batch.total_candidates,
                    total_processed: batch.total_processed,
                    batch_id: batch.batch_id.clone(),
                    completed_at_ms: batch.completed_at_ms.unwrap_or(0),
                }),
            )
        }
    };

    if let Some(progress) = progress_opt {
        notify_batch_compress_listeners(inner, progress);
    }

    if batch_id_opt.is_some() {
        notify_queue_listeners(inner);
    }
}
