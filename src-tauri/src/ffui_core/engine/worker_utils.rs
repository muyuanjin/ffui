use std::time::{
    SystemTime,
    UNIX_EPOCH,
};

use super::state::{
    Inner,
    SmartScanBatchStatus,
    notify_queue_listeners,
    notify_smart_scan_listeners,
};
use crate::ffui_core::domain::{
    AutoCompressProgress,
    FFmpegPreset,
    JobStatus,
    TranscodeJob,
};

pub(super) const MAX_LOG_TAIL_BYTES: usize = 64 * 1024;

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

/// Mark a Smart Scan child job as processed and update batch status if all
/// children are complete.
pub(super) fn mark_smart_scan_child_processed(inner: &Inner, job_id: &str) {
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

        let batch = match state.smart_scan_batches.get_mut(&batch_id) {
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
                SmartScanBatchStatus::Completed | SmartScanBatchStatus::Failed
            )
        {
            batch.status = SmartScanBatchStatus::Completed;
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
        notify_smart_scan_listeners(inner, progress);
    }

    if batch_id_opt.is_some() {
        notify_queue_listeners(inner);
    }
}
