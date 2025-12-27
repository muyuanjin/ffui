use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use crate::ffui_core::domain::JobStatus;
use crate::sync_ext::MutexExt;

use super::super::super::state::{Inner, notify_queue_listeners};

/// Permanently delete multiple terminal-state jobs in a single atomic operation.
///
/// This avoids per-job IPC + per-job notify storms during frontend bulk deletion.
pub(in crate::ffui_core::engine) fn delete_jobs_bulk(
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

        // Best-effort: delete only terminal jobs that are not active.
        // Ignore missing / non-terminal / active jobs so transient state changes
        // won't make the whole bulk delete fail.
        let mut deletable_job_ids: HashSet<String> = HashSet::new();
        for job_id in &unique_job_ids {
            let Some(job) = state.jobs.get(job_id.as_str()) else {
                continue;
            };

            match job.status {
                JobStatus::Completed
                | JobStatus::Failed
                | JobStatus::Skipped
                | JobStatus::Cancelled => {
                    if !state.active_jobs.contains(job_id.as_str()) {
                        deletable_job_ids.insert(job_id.clone());
                    }
                }
                _ => {}
            }
        }

        if deletable_job_ids.is_empty() {
            return true;
        }

        for job_id in &deletable_job_ids {
            if let Some(job) = state.jobs.get(job_id.as_str()) {
                cleanup_paths.extend(super::super::cleanup::collect_job_tmp_cleanup_paths(job));
            }
        }

        state.queue.retain(|id| !deletable_job_ids.contains(id));

        for job_id in &deletable_job_ids {
            state.cancelled_jobs.remove(job_id.as_str());
            state.wait_requests.remove(job_id.as_str());
            state.restart_requests.remove(job_id.as_str());
            state.jobs.remove(job_id.as_str());
        }

        should_notify = true;
    }

    if should_notify {
        notify_queue_listeners(inner);
    }

    for path in cleanup_paths {
        drop(std::fs::remove_file(path));
    }
    true
}
