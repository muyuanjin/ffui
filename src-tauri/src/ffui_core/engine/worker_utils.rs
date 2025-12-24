use std::time::{SystemTime, UNIX_EPOCH};

use super::state::{
    BatchCompressBatchStatus, Inner, notify_batch_compress_listeners, notify_queue_listeners,
};
use crate::ffui_core::domain::{
    AutoCompressProgress, EncoderType, FFmpegPreset, JobStatus, PresetStats, TranscodeJob,
};
use crate::sync_ext::MutexExt;

pub(super) const MAX_LOG_TAIL_BYTES: usize = 64 * 1024;
pub(super) const MAX_LOG_LINES: usize = 500;

fn truncate_string_to_last_bytes(s: &mut String, max_bytes: usize) {
    if s.len() <= max_bytes {
        return;
    }

    let mut start = s.len().saturating_sub(max_bytes);
    while start < s.len() && !s.is_char_boundary(start) {
        start = start.saturating_add(1);
    }
    s.replace_range(..start, "");
}

fn is_critical_log_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("error")
        || lower.contains("failed")
        || lower.contains("exited with")
        || lower.contains("invalid")
        || lower.trim_start().starts_with("command:")
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
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX)
}

/// Recompute the `log_tail` field of a job by joining all logs and truncating
/// to the last `MAX_LOG_TAIL_BYTES` bytes (without splitting UTF-8 codepoints).
pub(super) fn recompute_log_tail(job: &mut TranscodeJob) {
    if job.logs.is_empty() {
        job.log_tail = None;
        return;
    }

    let mut joined = job.logs.join("\n");
    truncate_string_to_last_bytes(&mut joined, MAX_LOG_TAIL_BYTES);
    job.log_tail = Some(joined);
}

/// Keep log lines bounded while preserving "critical" diagnostics.
///
/// This trims by removing the oldest non-critical lines across runs first,
/// keeping recent output while ensuring critical lines survive as long as
/// possible. When all remaining lines are critical, it drops the oldest.
pub(super) fn trim_job_logs_with_priority(job: &mut TranscodeJob) -> bool {
    if job.logs.len() <= MAX_LOG_LINES {
        return false;
    }

    if job.runs.is_empty() {
        while job.logs.len() > MAX_LOG_LINES {
            if let Some(idx) = job.logs.iter().position(|line| !is_critical_log_line(line)) {
                job.logs.remove(idx);
            } else if !job.logs.is_empty() {
                job.logs.remove(0);
            } else {
                break;
            }
        }
        return true;
    }

    // If the run logs drifted from the flat logs (should not happen after
    // migration), rebuild the flat view from runs before trimming.
    sync_job_logs_with_runs_if_needed(job);

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

    true
}

fn append_log_tail(job: &mut TranscodeJob, line: &str) {
    let tail = job.log_tail.get_or_insert_with(String::new);
    if !tail.is_empty() {
        tail.push('\n');
    }
    tail.push_str(line);
    truncate_string_to_last_bytes(tail, MAX_LOG_TAIL_BYTES);
}

pub(super) fn append_job_log_line(job: &mut TranscodeJob, line: impl Into<String>) {
    let line = line.into();
    let will_trim = job.logs.len().saturating_add(1) > MAX_LOG_LINES;

    // Common case: keep the tail up-to-date without rebuilding by joining all logs.
    // If trimming is required, we will recompute from the final (trimmed) logs.
    if !will_trim {
        append_log_tail(job, &line);
    }

    job.logs.push(line);
    if let Some(run) = job.runs.last_mut()
        && let Some(last) = job.logs.last()
    {
        run.logs.push(last.clone());
    }

    if will_trim && trim_job_logs_with_priority(job) {
        recompute_log_tail(job);
    }
}

/// Estimate the expected duration in seconds for a job based on preset statistics.
pub(super) fn estimate_job_seconds_for_preset(size_mb: f64, preset: &FFmpegPreset) -> Option<f64> {
    if size_mb <= 0.0 {
        return None;
    }

    let mut seconds_per_mb = base_seconds_per_mb(&preset.stats)?;
    seconds_per_mb *= encoder_factor_for_estimate(&preset.video.encoder);

    let mut factor = 1.0f64;
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

pub(super) fn base_seconds_per_mb(stats: &PresetStats) -> Option<f64> {
    if stats.total_input_size_mb <= 0.0 || stats.total_time_seconds <= 0.0 {
        return None;
    }
    let seconds_per_mb = stats.total_time_seconds / stats.total_input_size_mb;
    if seconds_per_mb.is_finite() && seconds_per_mb > 0.0 {
        Some(seconds_per_mb)
    } else {
        None
    }
}

pub(super) fn encoder_factor_for_estimate(encoder: &EncoderType) -> f64 {
    match encoder {
        EncoderType::LibSvtAv1 => 1.5,
        EncoderType::HevcNvenc => 0.9,
        _ => 1.0,
    }
}

/// Mark a Batch Compress child job as processed and update batch status if all
/// children are complete.
pub(super) fn mark_batch_compress_child_processed(inner: &Inner, job_id: &str) {
    let (batch_id_opt, progress_opt) = {
        let mut state = inner.state.lock_unpoisoned();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffui_core::domain::JobStatus;

    fn make_job() -> crate::ffui_core::domain::TranscodeJob {
        crate::test_support::make_transcode_job_for_tests("job-1", JobStatus::Waiting, 0.0, None)
    }

    #[test]
    fn recompute_log_tail_never_panics_on_utf8_boundary() {
        let mut job = make_job();

        // Joined logs length = MAX_LOG_TAIL_BYTES + 1 bytes; start index would
        // land in the middle of the first UTF-8 codepoint ("你") if sliced by bytes.
        let s = format!("你{}", "a".repeat(MAX_LOG_TAIL_BYTES.saturating_sub(2)));
        assert_eq!(s.len(), MAX_LOG_TAIL_BYTES + 1);

        job.logs = vec![s];
        recompute_log_tail(&mut job);

        let tail = job.log_tail.expect("tail should be set");
        assert!(
            tail.len() <= MAX_LOG_TAIL_BYTES,
            "tail must be bounded by bytes"
        );
        assert!(
            tail.starts_with('a'),
            "tail should drop the partial UTF-8 prefix safely"
        );
    }

    #[test]
    fn append_job_log_line_updates_log_tail_incrementally() {
        let mut job = make_job();
        append_job_log_line(&mut job, "line-1");
        assert_eq!(job.log_tail.as_deref(), Some("line-1"));

        append_job_log_line(&mut job, "line-2");
        assert_eq!(job.log_tail.as_deref(), Some("line-1\nline-2"));
    }
}
