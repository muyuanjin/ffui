use std::sync::Arc;

use super::super::state::{
    Inner,
    notify_queue_listeners,
};
use super::super::worker_utils::{
    current_time_millis,
    recompute_log_tail,
};
use crate::ffui_core::domain::JobStatus;

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
                    job.status = JobStatus::Cancelled;
                    job.progress = 0.0;
                    job.end_time = Some(current_time_millis());
                    job.logs.push("Cancelled before start".to_string());
                    job.log_head = None;
                    recompute_log_tail(job);
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
                    // Best-effort cleanup: when cancelling a paused job, remove any
                    // partial output segments that were produced by previous runs.
                    if let Some(meta) = job.wait_metadata.as_ref() {
                        if let Some(ref segs) = meta.segments {
                            for s in segs {
                                if !s.trim().is_empty() {
                                    cleanup_paths.push(std::path::PathBuf::from(s));
                                }
                            }
                        }
                        if let Some(tmp) = meta.tmp_output_path.as_ref()
                            && !tmp.trim().is_empty()
                        {
                            cleanup_paths.push(std::path::PathBuf::from(tmp));
                        }
                    }

                    job.status = JobStatus::Cancelled;
                    job.progress = 0.0;
                    job.end_time = Some(current_time_millis());
                    job.logs.push("Cancelled while paused".to_string());
                    job.log_head = None;
                    job.wait_metadata = None;
                    recompute_log_tail(job);
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
                        job.logs.push(
                            "Resume requested while wait was pending; cancelling wait request"
                                .to_string(),
                        );
                        recompute_log_tail(job);
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
                job.status = JobStatus::Waiting;
                job.progress = 0.0;
                job.end_time = None;
                job.failure_reason = None;
                job.skip_reason = None;
                job.wait_metadata = None;
                job.logs
                    .push("Restart requested from UI; job will re-run from 0%".to_string());
                job.log_head = None;
                recompute_log_tail(job);

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

/// Permanently delete all Smart Scan child jobs for a given batch id.
///
/// 语义约定：
/// - 仅当该批次的所有子任务均已处于终态（Completed/Failed/Skipped/Cancelled）且 当前没有处于
///   active_jobs 状态时才执行删除；否则直接返回 false，不做任何修改；
/// - 删除成功后会同时清理队列中的相关 bookkeeping（queue / cancelled / wait / restart）；
/// - 当该批次所有子任务都被移除后，连同 smart_scan_batches 中的批次元数据一并移除，
///   这样前端复合任务卡片也会从队列中消失。
pub(in crate::ffui_core::engine) fn delete_smart_scan_batch(
    inner: &Arc<Inner>,
    batch_id: &str,
) -> bool {
    use crate::ffui_core::engine::state::SmartScanBatchStatus;

    {
        let mut state = inner.state.lock().expect("engine state poisoned");

        let batch = match state.smart_scan_batches.get(batch_id) {
            Some(b) => b.clone(),
            None => return false,
        };

        // 如果批次仍处于 Scanning/Running 等非终态，则拒绝删除，交由前端提示。
        if !matches!(batch.status, SmartScanBatchStatus::Completed) {
            return false;
        }

        // 先遍历一遍，确保所有子任务都处于终态且不是当前 active_jobs。
        for job_id in &batch.child_job_ids {
            if let Some(job) = state.jobs.get(job_id) {
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
                        // Smart Scan 批次中仍存在非终态子任务，保持与单个 delete_job 一致的保护行为。
                        return false;
                    }
                }
            }
        }

        // 所有校验通过后，真正删除该批次的所有子任务以及批次元数据。
        for job_id in &batch.child_job_ids {
            state.queue.retain(|id| id != job_id);
            state.cancelled_jobs.remove(job_id);
            state.wait_requests.remove(job_id);
            state.restart_requests.remove(job_id);
            state.jobs.remove(job_id);
        }

        // 子任务删除后，清理批次记录，这样前端不会再渲染空壳的“复合任务”卡片。
        state.smart_scan_batches.remove(batch_id);
    }

    notify_queue_listeners(inner);
    true
}
