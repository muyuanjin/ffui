use std::sync::Arc;

use super::super::state::{
    Inner,
    notify_queue_listeners,
};
use super::super::worker_utils::{
    append_job_log_line,
    current_time_millis,
};
use crate::ffui_core::domain::{
    JobStatus,
    WaitMetadata,
};

fn collect_wait_metadata_cleanup_paths(meta: &WaitMetadata) -> Vec<std::path::PathBuf> {
    use std::collections::HashSet;

    let mut raw_paths: Vec<&str> = Vec::new();
    if let Some(segs) = meta.segments.as_ref()
        && !segs.is_empty()
    {
        raw_paths.extend(segs.iter().map(|s| s.as_str()));
    } else if let Some(tmp) = meta.tmp_output_path.as_ref() {
        raw_paths.push(tmp.as_str());
    }

    let mut out: Vec<std::path::PathBuf> = Vec::new();
    let mut seen: HashSet<std::path::PathBuf> = HashSet::new();
    for raw in raw_paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = std::path::PathBuf::from(trimmed);
        if seen.insert(path.clone()) {
            out.push(path.clone());
        }
        let marker = super::super::job_runner::noaudio_marker_path_for_segment(path.as_path());
        if seen.insert(marker.clone()) {
            out.push(marker);
        }
    }
    out
}

/// Cancel a job by ID.
///
/// If the job is waiting/queued, removes it from the queue and marks as cancelled.
/// If the job is paused, transitions it directly into Cancelled so it can be deleted.
/// If the job is processing, marks it for cooperative cancellation by the worker.
/// Returns true if the job was successfully cancelled or marked for cancellation.
pub(in crate::ffui_core::engine) fn cancel_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let mut should_notify = false;
    let mut cleanup_paths: Vec<std::path::PathBuf> = Vec::new();

    let result = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let status = match state.jobs.get(job_id) {
            Some(job) => job.status.clone(),
            None => return false,
        };

        match status {
            JobStatus::Waiting | JobStatus::Queued => {
                // Remove from queue and mark as cancelled without ever starting ffmpeg.
                state.queue.retain(|id| id != job_id);
                if let Some(job) = state.jobs.get_mut(job_id) {
                    if let Some(meta) = job.wait_metadata.as_ref() {
                        cleanup_paths.extend(collect_wait_metadata_cleanup_paths(meta));
                    }
                    job.status = JobStatus::Cancelled;
                    job.progress = 0.0;
                    job.end_time = Some(current_time_millis());
                    append_job_log_line(job, "Cancelled before start".to_string());
                    job.log_head = None;
                    job.wait_metadata = None;
                }
                // Any stale flags become irrelevant.
                state.cancelled_jobs.remove(job_id);
                state.wait_requests.remove(job_id);
                state.restart_requests.remove(job_id);
                should_notify = true;
                true
            }
            JobStatus::Paused => {
                state.queue.retain(|id| id != job_id);
                if let Some(job) = state.jobs.get_mut(job_id) {
                    if let Some(meta) = job.wait_metadata.as_ref() {
                        cleanup_paths.extend(collect_wait_metadata_cleanup_paths(meta));
                    }

                    job.status = JobStatus::Cancelled;
                    job.progress = 0.0;
                    job.end_time = Some(current_time_millis());
                    append_job_log_line(job, "Cancelled while paused".to_string());
                    job.log_head = None;
                    job.wait_metadata = None;
                }
                state.cancelled_jobs.remove(job_id);
                state.wait_requests.remove(job_id);
                state.restart_requests.remove(job_id);
                should_notify = true;
                true
            }
            JobStatus::Processing => {
                // Mark for cooperative cancellation; the worker thread will
                // observe this and terminate the underlying ffmpeg process.
                // If a wait request is pending, cancel takes precedence.
                if let Some(meta) = state
                    .jobs
                    .get(job_id)
                    .and_then(|job| job.wait_metadata.as_ref())
                {
                    cleanup_paths.extend(collect_wait_metadata_cleanup_paths(meta));
                }
                state.wait_requests.remove(job_id);
                state.cancelled_jobs.insert(job_id.to_string());
                should_notify = true;
                true
            }
            _ => false,
        }
    };

    if should_notify {
        notify_queue_listeners(inner);
    }

    // Perform filesystem cleanup outside of the engine lock.
    for path in cleanup_paths {
        let _ = std::fs::remove_file(path);
    }

    result
}

/// Request that a running job transition into a "wait" state, releasing
/// its worker slot while preserving progress. The actual state change is
/// performed cooperatively inside the worker loop.
pub(in crate::ffui_core::engine) fn wait_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let mut should_notify = false;

    let result = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let status = match state.jobs.get(job_id) {
            Some(job) => job.status.clone(),
            None => return false,
        };

        match status {
            JobStatus::Processing => {
                state.wait_requests.insert(job_id.to_string());
                should_notify = true;
                true
            }
            _ => false,
        }
    };

    if should_notify {
        notify_queue_listeners(inner);
    }

    result
}

/// Resume a paused/waited job by putting it back into the waiting queue while
/// keeping its progress/wait metadata intact。Processing 状态下如仍有待处理暂停
/// 请求，则直接取消，避免快速“暂停→继续”引发的竞态。
pub(in crate::ffui_core::engine) fn resume_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let mut should_notify = false;

    let result = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get_mut(job_id) {
            Some(job) => job,
            None => return false,
        };

        match job.status {
            JobStatus::Paused => {
                job.status = JobStatus::Waiting;
                if !state.queue.iter().any(|id| id == job_id) {
                    state.queue.push_back(job_id.to_string());
                }
                should_notify = true;
                true
            }
            JobStatus::Processing => {
                // 任务仍在处理中且存在待处理暂停时，直接取消暂停请求。
                let wait_request_cancelled = {
                    // 先释放对 job 的可变借用，再操作 wait_requests，避免重复可变借用。
                    let _ = job;
                    state.wait_requests.remove(job_id)
                };

                if !wait_request_cancelled {
                    // 没有待处理的暂停请求，任务正在正常处理中，无需操作
                    false
                } else {
                    if let Some(job) = state.jobs.get_mut(job_id) {
                        append_job_log_line(
                            job,
                            "Resume requested while wait was pending; cancelling wait request"
                                .to_string(),
                        );
                    }
                    should_notify = true;
                    true
                }
            }
            _ => false,
        }
    };

    if should_notify {
        inner.cv.notify_one();
        notify_queue_listeners(inner);
    }

    result
}

/// Restart a job from 0% progress. For jobs that are currently processing
/// this schedules a cooperative cancellation followed by a fresh enqueue
/// in `mark_job_cancelled`. For non-processing jobs the state is reset
/// immediately and the job is reinserted into the waiting queue.
pub(in crate::ffui_core::engine) fn restart_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let mut should_notify = false;
    let mut cleanup_paths: Vec<std::path::PathBuf> = Vec::new();

    let result = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get_mut(job_id) {
            Some(job) => job,
            None => return false,
        };

        match job.status {
            JobStatus::Completed | JobStatus::Skipped => false,
            JobStatus::Processing => {
                state.restart_requests.insert(job_id.to_string());
                state.cancelled_jobs.insert(job_id.to_string());
                should_notify = true;
                true
            }
            _ => {
                // Reset immediately for non-processing jobs.
                if let Some(meta) = job.wait_metadata.as_ref() {
                    cleanup_paths.extend(collect_wait_metadata_cleanup_paths(meta));
                }
                job.status = JobStatus::Waiting;
                job.progress = 0.0;
                job.end_time = None;
                job.failure_reason = None;
                job.skip_reason = None;
                job.wait_metadata = None;
                append_job_log_line(
                    job,
                    "Restart requested from UI; job will re-run from 0%".to_string(),
                );
                job.log_head = None;

                if !state.queue.iter().any(|id| id == job_id) {
                    state.queue.push_back(job_id.to_string());
                }

                should_notify = true;
                // Any old restart or cancel flags become irrelevant.
                state.restart_requests.remove(job_id);
                state.cancelled_jobs.remove(job_id);
                true
            }
        }
    };

    if should_notify {
        inner.cv.notify_one();
        notify_queue_listeners(inner);
    }

    for path in cleanup_paths {
        let _ = std::fs::remove_file(path);
    }

    result
}

/// Permanently delete a job from the engine state.
///
/// Only terminal-state jobs (Completed/Failed/Skipped/Cancelled) are eligible
/// for deletion. Active or waiting jobs are kept to avoid silently losing
/// work that is still running or scheduled.
pub(in crate::ffui_core::engine) fn delete_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get(job_id) {
            Some(j) => j.clone(),
            None => return false,
        };

        match job.status {
            JobStatus::Completed
            | JobStatus::Failed
            | JobStatus::Skipped
            | JobStatus::Cancelled => {
                // Guard against deleting the currently active job even if the
                // status somehow appears terminal; this should not normally
                // happen but keeps the behaviour defensive.
                if state.active_jobs.contains(job_id) {
                    return false;
                }

                // Remove from waiting queue and book-keeping sets.
                state.queue.retain(|id| id != job_id);
                state.cancelled_jobs.remove(job_id);
                state.wait_requests.remove(job_id);
                state.restart_requests.remove(job_id);

                // Finally drop the job record.
                state.jobs.remove(job_id);
            }
            _ => {
                // Non-terminal jobs cannot be deleted directly.
                return false;
            }
        }
    }

    notify_queue_listeners(inner);
    true
}

/// Permanently delete all Batch Compress child jobs for a given batch id.
///
/// 语义约定：
/// - 仅当该批次的所有子任务均已处于终态（Completed/Failed/Skipped/Cancelled）且 当前没有处于
///   active_jobs 状态时才执行删除；否则直接返回 false，不做任何修改；
/// - 删除成功后会同时清理队列中的相关 bookkeeping（queue / cancelled / wait / restart）；
/// - 当该批次所有子任务都被移除后，连同 batch_compress_batches 中的批次元数据一并移除，
///   这样前端复合任务卡片也会从队列中消失。
pub(in crate::ffui_core::engine) fn delete_batch_compress_batch(
    inner: &Arc<Inner>,
    batch_id: &str,
) -> bool {
    use crate::ffui_core::engine::state::BatchCompressBatchStatus;

    {
        let mut state = inner.state.lock().expect("engine state poisoned");

        let batch_opt = state.batch_compress_batches.get(batch_id).cloned();
        if let Some(batch) = batch_opt.as_ref()
            && matches!(batch.status, BatchCompressBatchStatus::Scanning)
        {
            // Defensive: avoid deleting a batch that is still scanning and may
            // enqueue more jobs concurrently.
            return false;
        }

        // Backward compatibility: older persisted queues may contain child
        // jobs with `batch_id` but have no in-memory `batch_compress_batches`
        // metadata after crash recovery. In that case derive children from
        // the jobs map and delete the batch safely based on job terminality.
        let child_job_ids: Vec<String> = state
            .jobs
            .iter()
            .filter_map(|(id, job)| {
                if job.batch_id.as_deref() == Some(batch_id) {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();

        if child_job_ids.is_empty() {
            // No children found in current engine state. If batch metadata exists,
            // fall back to the legacy "logical completion" heuristic so empty
            // batches (e.g. missing preset) remain deletable.
            let Some(batch) = batch_opt else {
                return false;
            };

            let batch_is_deletable = matches!(batch.status, BatchCompressBatchStatus::Completed)
                || (!matches!(batch.status, BatchCompressBatchStatus::Scanning)
                    && batch.total_processed >= batch.total_candidates);
            if !batch_is_deletable {
                return false;
            }

            state.batch_compress_batches.remove(batch_id);
        } else {
            // Ensure every child is terminal and not currently active.
            for job_id in &child_job_ids {
                let Some(job) = state.jobs.get(job_id) else {
                    continue;
                };

                match job.status {
                    JobStatus::Completed
                    | JobStatus::Failed
                    | JobStatus::Skipped
                    | JobStatus::Cancelled => {
                        if state.active_jobs.contains(job_id.as_str()) {
                            return false;
                        }
                    }
                    _ => {
                        // Keep the same defensive semantics as delete_job:
                        // non-terminal jobs cannot be deleted in bulk.
                        return false;
                    }
                }
            }

            for job_id in &child_job_ids {
                state.queue.retain(|id| id != job_id);
                state.cancelled_jobs.remove(job_id);
                state.wait_requests.remove(job_id);
                state.restart_requests.remove(job_id);
                state.jobs.remove(job_id);
            }

            // Remove batch metadata if present so the frontend composite card
            // disappears after queue refresh.
            state.batch_compress_batches.remove(batch_id);
        }
    }

    notify_queue_listeners(inner);
    true
}
