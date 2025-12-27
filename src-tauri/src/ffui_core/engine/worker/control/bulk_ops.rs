use std::path::PathBuf;
use std::sync::Arc;

use crate::ffui_core::domain::JobStatus;
use crate::sync_ext::MutexExt;

use super::super::super::state::{EngineState, Inner, notify_queue_listeners};
use super::super::super::worker_utils::append_job_log_line;
use super::super::cleanup::collect_job_tmp_cleanup_paths;

fn run_bulk_job_op(
    inner: &Arc<Inner>,
    job_ids: Vec<String>,
    notify_cv: bool,
    mut op: impl FnMut(&mut EngineState, &str, &mut Vec<PathBuf>) -> bool,
) -> bool {
    let Some(unique_job_ids) = super::unique_nonempty_job_ids(job_ids) else {
        return true;
    };

    let mut cleanup_paths: Vec<PathBuf> = Vec::new();
    let mut should_notify = false;

    {
        let mut state = inner.state.lock_unpoisoned();

        for job_id in &unique_job_ids {
            if op(&mut state, job_id.as_str(), &mut cleanup_paths) {
                should_notify = true;
            }
        }
    }

    if should_notify {
        if notify_cv {
            inner.cv.notify_all();
        }
        notify_queue_listeners(inner);
    }

    super::cleanup_temp_files_best_effort(cleanup_paths);
    true
}

pub(in crate::ffui_core::engine) fn cancel_jobs_bulk(
    inner: &Arc<Inner>,
    job_ids: Vec<String>,
) -> bool {
    run_bulk_job_op(inner, job_ids, false, |state, job_id, cleanup_paths| {
        let status = match state.jobs.get(job_id) {
            Some(job) => job.status,
            None => return false,
        };

        match status {
            JobStatus::Queued => {
                super::cancel_waiting_like_job(
                    state,
                    job_id,
                    cleanup_paths,
                    "Cancelled before start",
                );
                true
            }
            JobStatus::Paused => {
                super::cancel_waiting_like_job(
                    state,
                    job_id,
                    cleanup_paths,
                    "Cancelled while paused",
                );
                true
            }
            JobStatus::Processing => {
                if let Some(job) = state.jobs.get(job_id) {
                    cleanup_paths.extend(collect_job_tmp_cleanup_paths(job));
                }
                state.wait_requests.remove(job_id);
                state.cancelled_jobs.insert(job_id.to_string())
            }
            _ => {
                // Best-effort: ignore terminal / ineligible jobs so transient
                // state changes won't make the whole bulk cancel fail.
                false
            }
        }
    })
}
pub(in crate::ffui_core::engine) fn resume_jobs_bulk(
    inner: &Arc<Inner>,
    job_ids: Vec<String>,
) -> bool {
    if job_ids.is_empty() {
        return true;
    }

    let filtered_job_ids: Vec<String> = job_ids
        .into_iter()
        .filter(|job_id| !job_id.trim().is_empty())
        .collect();
    if filtered_job_ids.is_empty() {
        return true;
    }

    let mut should_notify = false;
    {
        let mut state = inner.state.lock_unpoisoned();

        for job_id in &filtered_job_ids {
            let status = match state.jobs.get(job_id.as_str()) {
                Some(job) => job.status,
                None => continue,
            };

            match status {
                JobStatus::Queued => {
                    if !state.queue.iter().any(|id| id == job_id) {
                        state.queue.push_back(job_id.to_string());
                        should_notify = true;
                    }
                    state.wait_requests.remove(job_id.as_str());
                    state.cancelled_jobs.remove(job_id.as_str());
                    state.restart_requests.remove(job_id.as_str());
                }
                JobStatus::Paused => {
                    if let Some(job) = state.jobs.get_mut(job_id.as_str()) {
                        job.status = JobStatus::Queued;
                        should_notify = true;
                    }
                    if !state.queue.iter().any(|id| id == job_id) {
                        state.queue.push_back(job_id.to_string());
                    }
                    state.wait_requests.remove(job_id.as_str());
                    state.cancelled_jobs.remove(job_id.as_str());
                    state.restart_requests.remove(job_id.as_str());
                }
                _ => {
                    // Best-effort: ignore terminal / ineligible jobs so transient
                    // state changes won't make the whole bulk resume fail.
                }
            }
        }
    }

    if should_notify {
        inner.cv.notify_all();
        notify_queue_listeners(inner);
    }

    true
}

pub(in crate::ffui_core::engine) fn restart_jobs_bulk(
    inner: &Arc<Inner>,
    job_ids: Vec<String>,
) -> bool {
    run_bulk_job_op(inner, job_ids, true, |state, job_id, cleanup_paths| {
        let Some(job) = state.jobs.get_mut(job_id) else {
            return false;
        };

        match job.status {
            JobStatus::Processing => {
                state.restart_requests.insert(job_id.to_string());
                state.cancelled_jobs.insert(job_id.to_string());
                true
            }
            JobStatus::Completed | JobStatus::Skipped => {
                // Best-effort: ignore ineligible jobs.
                false
            }
            _ => {
                cleanup_paths.extend(collect_job_tmp_cleanup_paths(job));
                job.status = JobStatus::Queued;
                job.progress = 0.0;
                job.end_time = None;
                job.failure_reason = None;
                job.skip_reason = None;
                job.wait_metadata = None;
                append_job_log_line(
                    job,
                    "Bulk restart requested from UI; job will re-run from 0%".to_string(),
                );
                job.log_head = None;

                if !state.queue.iter().any(|id| id == job_id) {
                    state.queue.push_back(job_id.to_string());
                }

                state.wait_requests.remove(job_id);
                state.cancelled_jobs.remove(job_id);
                state.restart_requests.remove(job_id);
                true
            }
        }
    })
}
