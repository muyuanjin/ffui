use std::sync::Arc;

use super::super::super::state::{Inner, notify_queue_listeners};
use super::super::super::worker_utils::append_job_log_line;
use crate::ffui_core::domain::JobStatus;
use crate::sync_ext::MutexExt;

/// Resume a paused/waited job by putting it back into the waiting queue while
/// keeping its progress/wait metadata intact。Processing 状态下如仍有待处理暂停
/// 请求，则直接取消，避免快速“暂停→继续”引发的竞态。
pub(in crate::ffui_core::engine) fn resume_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let queued_result = {
        let state = inner.state.lock_unpoisoned();
        let status = match state.jobs.get(job_id) {
            Some(job) => job.status,
            None => return false,
        };

        match status {
            JobStatus::Queued => Some(true),
            JobStatus::Paused => None,
            JobStatus::Processing => Some(false),
            _ => Some(false),
        }
    };

    if let Some(result) = queued_result {
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
                        (false, false)
                    }
                }
                _ => (result, false),
            }
        };

        if should_notify {
            inner.cv.notify_one();
            notify_queue_listeners(inner);
        }
        return result;
    }

    let (result, should_notify) = {
        let mut state = inner.state.lock_unpoisoned();
        let status = match state.jobs.get(job_id) {
            Some(job) => job.status,
            None => return false,
        };
        if status != JobStatus::Paused {
            return false;
        }

        if let Some(job) = state.jobs.get_mut(job_id) {
            job.status = JobStatus::Queued;
        }
        if !state.queue.iter().any(|id| id == job_id) {
            state.queue.push_back(job_id.to_string());
        }
        state.wait_requests.remove(job_id);
        state.cancelled_jobs.remove(job_id);
        state.restart_requests.remove(job_id);
        (true, true)
    };

    if should_notify {
        inner.cv.notify_one();
        notify_queue_listeners(inner);
    }

    result
}
