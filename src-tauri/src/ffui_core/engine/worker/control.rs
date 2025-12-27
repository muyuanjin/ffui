use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use super::super::state::{Inner, notify_queue_listeners};
use super::super::worker_utils::{append_job_log_line, current_time_millis};
use crate::ffui_core::domain::JobStatus;
use crate::sync_ext::MutexExt;

use super::cleanup::collect_job_tmp_cleanup_paths;

mod batch_ops;
pub(in crate::ffui_core::engine) use batch_ops::{
    delete_batch_compress_batch, delete_batch_compress_batches_bulk,
};
mod bulk_ops;
pub(in crate::ffui_core::engine) use bulk_ops::{
    cancel_jobs_bulk, restart_jobs_bulk, resume_jobs_bulk,
};
mod delete_ops;
pub(in crate::ffui_core::engine) use delete_ops::delete_jobs_bulk;

fn unique_nonempty_job_ids(job_ids: Vec<String>) -> Option<HashSet<String>> {
    let unique: HashSet<String> = job_ids
        .into_iter()
        .filter(|job_id| !job_id.trim().is_empty())
        .collect();
    if unique.is_empty() {
        None
    } else {
        Some(unique)
    }
}

fn cleanup_temp_files_best_effort(paths: Vec<PathBuf>) {
    for path in paths {
        drop(std::fs::remove_file(path));
    }
}

fn cancel_waiting_like_job(
    state: &mut super::super::state::EngineState,
    job_id: &str,
    cleanup_paths: &mut Vec<std::path::PathBuf>,
    message: &'static str,
) {
    // Remove from queue and mark as cancelled without ever starting ffmpeg.
    state.queue.retain(|id| id != job_id);
    if let Some(job) = state.jobs.get_mut(job_id) {
        cleanup_paths.extend(collect_job_tmp_cleanup_paths(job));
        job.status = JobStatus::Cancelled;
        job.progress = 0.0;
        job.end_time = Some(current_time_millis());
        append_job_log_line(job, message.to_string());
        job.log_head = None;
        job.wait_metadata = None;
    }
    // Any stale flags become irrelevant.
    state.cancelled_jobs.remove(job_id);
    state.wait_requests.remove(job_id);
    state.restart_requests.remove(job_id);
}

/// Cancel a job by ID.
///
/// If the job is waiting/queued, removes it from the queue and marks as cancelled.
/// If the job is paused, transitions it directly into Cancelled so it can be deleted.
/// If the job is processing, marks it for cooperative cancellation by the worker.
/// Returns true if the job was successfully cancelled or marked for cancellation.
pub(in crate::ffui_core::engine) fn cancel_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let mut cleanup_paths: Vec<std::path::PathBuf> = Vec::new();

    let (result, should_notify) = {
        let mut state = inner.state.lock_unpoisoned();
        let status = match state.jobs.get(job_id) {
            Some(job) => job.status,
            None => return false,
        };

        match status {
            JobStatus::Queued => {
                cancel_waiting_like_job(
                    &mut state,
                    job_id,
                    &mut cleanup_paths,
                    "Cancelled before start",
                );
                (true, true)
            }
            JobStatus::Paused => {
                cancel_waiting_like_job(
                    &mut state,
                    job_id,
                    &mut cleanup_paths,
                    "Cancelled while paused",
                );
                (true, true)
            }
            JobStatus::Processing => {
                // Mark for cooperative cancellation; the worker thread will
                // observe this and terminate the underlying ffmpeg process.
                // If a wait request is pending, cancel takes precedence.
                if let Some(job) = state.jobs.get(job_id) {
                    cleanup_paths.extend(collect_job_tmp_cleanup_paths(job));
                }
                state.wait_requests.remove(job_id);
                state.cancelled_jobs.insert(job_id.to_string());
                (true, true)
            }
            _ => (false, false),
        }
    };

    if should_notify {
        notify_queue_listeners(inner);
    }

    // Perform filesystem cleanup outside of the engine lock.
    for path in cleanup_paths {
        drop(std::fs::remove_file(path));
    }

    result
}

/// Request that a running job transition into a "wait" state, releasing
/// its worker slot while preserving progress. The actual state change is
/// performed cooperatively inside the worker loop.
pub(in crate::ffui_core::engine) fn wait_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let (result, should_notify) = {
        let mut state = inner.state.lock_unpoisoned();
        let status = match state.jobs.get(job_id) {
            Some(job) => job.status,
            None => return false,
        };

        match status {
            JobStatus::Processing => {
                state.wait_requests.insert(job_id.to_string());
                (true, true)
            }
            JobStatus::Queued => {
                if let Some(job) = state.jobs.get_mut(job_id) {
                    job.status = JobStatus::Paused;
                    append_job_log_line(job, "Paused while waiting".to_string());
                    job.log_head = None;
                }
                // Any stale flags become irrelevant.
                state.wait_requests.remove(job_id);
                state.cancelled_jobs.remove(job_id);
                state.restart_requests.remove(job_id);
                (true, true)
            }
            JobStatus::Paused => (true, false),
            _ => (false, false),
        }
    };

    if should_notify {
        notify_queue_listeners(inner);
    }

    result
}

/// Pause multiple jobs in a single atomic engine lock acquisition.
///
/// This is primarily used by frontend bulk pause operations to prevent a race
/// where pausing a running job frees a worker slot and starts a queued job
/// before the UI can send subsequent per-job pause commands.
pub(in crate::ffui_core::engine) fn wait_jobs_bulk(
    inner: &Arc<Inner>,
    job_ids: Vec<String>,
) -> bool {
    let should_notify = {
        let mut state = inner.state.lock_unpoisoned();

        let mut should_notify = false;
        for job_id in &job_ids {
            if job_id.trim().is_empty() {
                continue;
            }
            let status = match state.jobs.get(job_id.as_str()) {
                Some(job) => job.status,
                None => continue,
            };

            match status {
                JobStatus::Processing => {
                    if state.wait_requests.insert(job_id.clone()) {
                        should_notify = true;
                    }
                }
                JobStatus::Queued => {
                    if let Some(job) = state.jobs.get_mut(job_id.as_str()) {
                        job.status = JobStatus::Paused;
                        append_job_log_line(job, "Paused while waiting".to_string());
                        job.log_head = None;
                    }
                    state.wait_requests.remove(job_id.as_str());
                    state.cancelled_jobs.remove(job_id.as_str());
                    state.restart_requests.remove(job_id.as_str());
                    should_notify = true;
                }
                JobStatus::Paused => {
                    // Idempotent: nothing to do.
                }
                _ => {
                    // Best-effort: ignore terminal / ineligible jobs so transient
                    // status changes (e.g. "processing -> completed") won't make
                    // the whole bulk pause fail.
                }
            }
        }

        should_notify
    };

    if should_notify {
        notify_queue_listeners(inner);
    }

    true
}

/// Resume a paused/waited job by putting it back into the waiting queue while
/// keeping its progress/wait metadata intact。Processing 状态下如仍有待处理暂停
/// 请求，则直接取消，避免快速“暂停→继续”引发的竞态。
pub(in crate::ffui_core::engine) fn resume_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let (result, should_notify) = {
        let mut state = inner.state.lock_unpoisoned();
        let status = match state.jobs.get(job_id) {
            Some(job) => job.status,
            None => return false,
        };

        match status {
            JobStatus::Queued => {
                // Idempotent: ensure the job is enqueued so users can safely
                // click "resume" even if the frontend snapshot is stale.
                if !state.queue.iter().any(|id| id == job_id) {
                    state.queue.push_back(job_id.to_string());
                }
                // Any stale flags become irrelevant.
                state.wait_requests.remove(job_id);
                state.cancelled_jobs.remove(job_id);
                state.restart_requests.remove(job_id);
                (true, true)
            }
            JobStatus::Paused => {
                if let Some(job) = state.jobs.get_mut(job_id) {
                    job.status = JobStatus::Queued;
                }
                if !state.queue.iter().any(|id| id == job_id) {
                    state.queue.push_back(job_id.to_string());
                }
                // Any stale flags become irrelevant.
                state.wait_requests.remove(job_id);
                state.cancelled_jobs.remove(job_id);
                state.restart_requests.remove(job_id);
                (true, true)
            }
            JobStatus::Processing => {
                // 任务仍在处理中且存在待处理暂停时，直接取消暂停请求。
                let wait_request_cancelled = state.wait_requests.remove(job_id);

                if wait_request_cancelled {
                    if let Some(job) = state.jobs.get_mut(job_id) {
                        append_job_log_line(
                            job,
                            "Resume requested while wait was pending; cancelling wait request"
                                .to_string(),
                        );
                    }
                    (true, true)
                } else {
                    // 没有待处理的暂停请求，任务正在正常处理中，无需操作
                    (false, false)
                }
            }
            _ => (false, false),
        }
    };

    if should_notify {
        inner.cv.notify_one();
        notify_queue_listeners(inner);
    }

    result
}

/// Resume any jobs that were automatically paused during startup recovery.
///
/// This preserves the existing queue ordering and simply marks the jobs back
/// to Queued so the normal worker selection logic (and concurrency limits)
/// can schedule them again.
pub(in crate::ffui_core::engine) fn resume_startup_auto_paused_jobs(inner: &Arc<Inner>) -> usize {
    let auto_paused_set: std::collections::HashSet<String> = {
        let mut guard = inner.startup_auto_paused_job_ids.lock_unpoisoned();
        if guard.is_empty() {
            return 0;
        }
        guard.drain().collect()
    };

    let (resumed, should_notify) = {
        let mut state = inner.state.lock_unpoisoned();
        let mut resumed = 0usize;

        let queue_job_ids: Vec<String> = state.queue.iter().cloned().collect();
        for job_id in queue_job_ids {
            if !auto_paused_set.contains(&job_id) {
                continue;
            }
            let Some(job) = state.jobs.get_mut(&job_id) else {
                continue;
            };
            if job.status != JobStatus::Paused {
                continue;
            }
            job.status = JobStatus::Queued;
            resumed = resumed.saturating_add(1);

            state.wait_requests.remove(&job_id);
            state.cancelled_jobs.remove(&job_id);
            state.restart_requests.remove(&job_id);
        }

        let queue_set: std::collections::HashSet<String> = state.queue.iter().cloned().collect();
        for job_id in auto_paused_set {
            if queue_set.contains(&job_id) {
                continue;
            }
            let Some(job) = state.jobs.get_mut(&job_id) else {
                continue;
            };
            if job.status != JobStatus::Paused {
                continue;
            }
            job.status = JobStatus::Queued;
            resumed = resumed.saturating_add(1);
            state.queue.push_back(job_id.clone());

            state.wait_requests.remove(&job_id);
            state.cancelled_jobs.remove(&job_id);
            state.restart_requests.remove(&job_id);
        }

        (resumed, resumed > 0)
    };

    if should_notify {
        inner.cv.notify_all();
        notify_queue_listeners(inner);
    }

    resumed
}

/// Restart a job from 0% progress. For jobs that are currently processing
/// this schedules a cooperative cancellation followed by a fresh enqueue
/// in `mark_job_cancelled`. For non-processing jobs the state is reset
/// immediately and the job is reinserted into the waiting queue.
pub(in crate::ffui_core::engine) fn restart_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let mut should_notify = false;
    let mut cleanup_paths: Vec<std::path::PathBuf> = Vec::new();

    let result = {
        let mut state = inner.state.lock_unpoisoned();
        let Some(job) = state.jobs.get_mut(job_id) else {
            return false;
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
                cleanup_paths.extend(collect_job_tmp_cleanup_paths(job));
                job.status = JobStatus::Queued;
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
        inner.cv.notify_all();
        notify_queue_listeners(inner);
    }

    for path in cleanup_paths {
        drop(std::fs::remove_file(path));
    }

    result
}

/// Permanently delete a job from the engine state.
///
/// Only terminal-state jobs (Completed/Failed/Skipped/Cancelled) are eligible
/// for deletion. Active or waiting jobs are kept to avoid silently losing
/// work that is still running or scheduled.
pub(in crate::ffui_core::engine) fn delete_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let mut cleanup_paths: Vec<PathBuf> = Vec::new();
    {
        let mut state = inner.state.lock_unpoisoned();
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

                cleanup_paths.extend(collect_job_tmp_cleanup_paths(&job));

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

    for path in cleanup_paths {
        drop(std::fs::remove_file(path));
    }
    true
}
