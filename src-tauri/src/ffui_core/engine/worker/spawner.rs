use std::sync::Arc;
use std::thread;

use crate::ffui_core::domain::JobStatus;

use super::super::job_runner;
use super::super::state::{Inner, notify_queue_listeners};
use super::super::transcode_activity;
use super::super::worker_utils::{
    current_time_millis, mark_smart_scan_child_processed, recompute_log_tail,
};
use super::selection::next_job_for_worker_locked;

/// Spawn worker threads with a bounded count derived from cores/settings.
pub(in crate::ffui_core::engine) fn spawn_worker(inner: Arc<Inner>) {
    #[cfg(test)]
    {
        if std::env::var_os("FFUI_ENABLE_WORKERS_IN_TESTS").is_none() {
            return;
        }
    }

    let logical_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .max(1);

    let configured_max = {
        let state = inner.state.lock().expect("engine state poisoned");
        state.settings.max_parallel_jobs.unwrap_or(0)
    };

    let auto_workers = if logical_cores >= 4 {
        std::cmp::max(2, logical_cores / 2)
    } else {
        1
    };

    let worker_count = if configured_max == 0 {
        auto_workers
    } else {
        let max = configured_max as usize;
        // Clamp into [1, logical_cores] so we never oversubscribe the CPU.
        max.clamp(1, logical_cores)
    };

    for index in 0..worker_count {
        let inner_clone = inner.clone();
        thread::Builder::new()
            .name(format!("ffui-transcode-worker-{index}"))
            .spawn(move || worker_loop(inner_clone))
            .expect("failed to spawn transcoding worker thread");
    }
}

/// Worker loop: wait for jobs, process, handle cancellation/errors.
fn worker_loop(inner: Arc<Inner>) {
    loop {
        let job_id = {
            let mut state = inner.state.lock().expect("engine state poisoned");
            while state.queue.is_empty() {
                state = inner.cv.wait(state).expect("engine state poisoned");
            }

            match next_job_for_worker_locked(&mut state) {
                Some(id) => id,
                None => continue,
            }
        };

        // Mark today's transcode activity buckets as soon as a job enters
        // processing state so sparse/no-progress jobs still show activity.
        transcode_activity::record_processing_activity(&inner);

        // Notify listeners that a job has moved into processing state.
        notify_queue_listeners(&inner);

        // Call the job runner to process the transcode job
        if let Err(err) = job_runner::process_transcode_job(&inner, &job_id) {
            {
                let mut state = inner.state.lock().expect("engine state poisoned");
                if let Some(job) = state.jobs.get_mut(&job_id) {
                    job.status = JobStatus::Failed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
                    let reason = format!("Transcode failed: {err:#}");
                    job.failure_reason = Some(reason.clone());
                    job.logs.push(reason);
                    recompute_log_tail(job);
                }
            }
            mark_smart_scan_child_processed(&inner, &job_id);
        }

        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            state.active_job = None;
            state.cancelled_jobs.remove(&job_id);
        }

        // Broadcast final state for the completed / failed / skipped job.
        notify_queue_listeners(&inner);
    }
}
