use std::collections::HashSet;
use std::sync::Arc;

use crate::ffui_core::domain::JobStatus;
use crate::sync_ext::MutexExt;

use super::super::super::state::{Inner, notify_queue_listeners};

/// Resume any jobs that were automatically paused during startup recovery.
///
/// This preserves the existing queue ordering and simply marks the jobs back
/// to Queued so the normal worker selection logic (and concurrency limits)
/// can schedule them again.
pub(in crate::ffui_core::engine) fn resume_startup_auto_paused_jobs(inner: &Arc<Inner>) -> usize {
    let auto_paused_set: HashSet<String> = {
        let mut guard = inner.startup_auto_paused_job_ids.lock_unpoisoned();
        if guard.is_empty() {
            return 0;
        }
        guard.drain().collect()
    };

    let (resume_ids_in_queue, resume_extra_ids) = {
        let state = inner.state.lock_unpoisoned();

        let queue_job_ids: Vec<String> = state.queue.iter().cloned().collect();
        let queue_set: HashSet<String> = queue_job_ids.iter().cloned().collect();

        let mut resume_ids_in_queue: Vec<String> = Vec::new();
        let mut resume_extra_ids: Vec<String> = Vec::new();

        for job_id in &queue_job_ids {
            if !auto_paused_set.contains(job_id) {
                continue;
            }
            let Some(job) = state.jobs.get(job_id) else {
                continue;
            };
            if job.status != JobStatus::Paused {
                continue;
            }
            resume_ids_in_queue.push(job_id.clone());
        }

        for job_id in &auto_paused_set {
            if queue_set.contains(job_id) {
                continue;
            }
            let Some(job) = state.jobs.get(job_id) else {
                continue;
            };
            if job.status != JobStatus::Paused {
                continue;
            }
            resume_extra_ids.push(job_id.clone());
        }

        (resume_ids_in_queue, resume_extra_ids)
    };

    let (resumed, should_notify) = {
        let mut state = inner.state.lock_unpoisoned();
        let mut resumed = 0usize;

        for job_id in resume_ids_in_queue {
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

        for job_id in resume_extra_ids {
            if state.queue.iter().any(|id| id == &job_id) {
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
