use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use crate::ffui_core::domain::JobStatus;
use crate::sync_ext::MutexExt;

use super::super::super::state::{Inner, notify_queue_listeners};
use super::super::super::worker_utils::append_job_log_line;
use super::super::cleanup::collect_job_tmp_cleanup_paths;

pub(in crate::ffui_core::engine) fn cancel_jobs_bulk(
    inner: &Arc<Inner>,
    job_ids: Vec<String>,
) -> bool {
    if job_ids.is_empty() {
        return true;
    }

    let unique_job_ids: HashSet<String> = job_ids
        .into_iter()
        .filter(|job_id| !job_id.trim().is_empty())
        .collect();
    if unique_job_ids.is_empty() {
        return true;
    }

    let mut cleanup_paths: Vec<PathBuf> = Vec::new();
    let mut should_notify = false;

    {
        let mut state = inner.state.lock_unpoisoned();

        for job_id in &unique_job_ids {
            let status = match state.jobs.get(job_id.as_str()) {
                Some(job) => job.status,
                None => continue,
            };

            match status {
                JobStatus::Queued => {
                    super::cancel_waiting_like_job(
                        &mut state,
                        job_id.as_str(),
                        &mut cleanup_paths,
                        "Cancelled before start",
                    );
                    should_notify = true;
                }
                JobStatus::Paused => {
                    super::cancel_waiting_like_job(
                        &mut state,
                        job_id.as_str(),
                        &mut cleanup_paths,
                        "Cancelled while paused",
                    );
                    should_notify = true;
                }
                JobStatus::Processing => {
                    if let Some(job) = state.jobs.get(job_id.as_str()) {
                        cleanup_paths.extend(collect_job_tmp_cleanup_paths(job));
                    }
                    state.wait_requests.remove(job_id.as_str());
                    if state.cancelled_jobs.insert(job_id.clone()) {
                        should_notify = true;
                    }
                }
                _ => {
                    // Best-effort: ignore terminal / ineligible jobs so transient
                    // state changes won't make the whole bulk cancel fail.
                }
            }
        }
    }

    if should_notify {
        notify_queue_listeners(inner);
    }

    for path in cleanup_paths {
        drop(std::fs::remove_file(path));
    }

    true
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
    if job_ids.is_empty() {
        return true;
    }

    let unique_job_ids: HashSet<String> = job_ids
        .into_iter()
        .filter(|job_id| !job_id.trim().is_empty())
        .collect();
    if unique_job_ids.is_empty() {
        return true;
    }

    let mut cleanup_paths: Vec<PathBuf> = Vec::new();
    let mut should_notify = false;

    {
        let mut state = inner.state.lock_unpoisoned();

        for job_id in &unique_job_ids {
            let Some(job) = state.jobs.get_mut(job_id.as_str()) else {
                continue;
            };

            match job.status {
                JobStatus::Processing => {
                    state.restart_requests.insert(job_id.to_string());
                    state.cancelled_jobs.insert(job_id.to_string());
                    should_notify = true;
                }
                JobStatus::Completed | JobStatus::Skipped => {
                    // Best-effort: ignore ineligible jobs.
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

                    state.wait_requests.remove(job_id.as_str());
                    state.cancelled_jobs.remove(job_id.as_str());
                    state.restart_requests.remove(job_id.as_str());
                    should_notify = true;
                }
            }
        }
    }

    if should_notify {
        inner.cv.notify_all();
        notify_queue_listeners(inner);
    }

    for path in cleanup_paths {
        drop(std::fs::remove_file(path));
    }

    true
}
