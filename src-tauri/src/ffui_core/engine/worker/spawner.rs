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

/// Spawn (or extend) worker threads to satisfy current concurrency settings.
pub(in crate::ffui_core::engine) fn spawn_worker(inner: Arc<Inner>) {
    #[cfg(test)]
    {
        if std::env::var_os("FFUI_ENABLE_WORKERS_IN_TESTS").is_none() {
            return;
        }
    }

    let mut state = inner.state.lock().expect("engine state poisoned");
    let desired = match state.settings.parallelism_mode() {
        crate::ffui_core::settings::TranscodeParallelismMode::Unified => {
            state.settings.effective_max_parallel_jobs() as usize
        }
        crate::ffui_core::settings::TranscodeParallelismMode::Split => {
            (state.settings.effective_max_parallel_cpu_jobs() as usize)
                + (state.settings.effective_max_parallel_hw_jobs() as usize)
        }
    }
    .max(1);

    while state.spawned_workers < desired {
        let index = state.spawned_workers;
        let inner_clone = inner.clone();
        thread::Builder::new()
            .name(format!("ffui-transcode-worker-{index}"))
            .spawn(move || worker_loop(inner_clone))
            .expect("failed to spawn transcoding worker thread");
        state.spawned_workers += 1;
    }
}

/// Worker loop: wait for jobs, process, handle cancellation/errors.
fn worker_loop(inner: Arc<Inner>) {
    loop {
        let job_id = {
            let mut state = inner.state.lock().expect("engine state poisoned");
            loop {
                while state.queue.is_empty() {
                    state = inner.cv.wait(state).expect("engine state poisoned");
                }

                if let Some(id) = next_job_for_worker_locked(&mut state) {
                    break id;
                }

                // Queue is non-empty but no job is currently eligible (e.g. all
                // jobs are blocked behind an active input). Wait until either a
                // worker finishes or a queue mutation makes progress possible.
                state = inner.cv.wait(state).expect("engine state poisoned");
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
            let input = state.jobs.get(&job_id).map(|j| j.filename.clone());
            state.active_jobs.remove(&job_id);
            if let Some(input) = input {
                state.active_inputs.remove(&input);
            }
            state.cancelled_jobs.remove(&job_id);
        }

        // Broadcast final state for the completed / failed / skipped job.
        notify_queue_listeners(&inner);
        // Wake any worker threads waiting for a previously blocked input.
        inner.cv.notify_all();
    }
}
