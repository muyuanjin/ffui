use std::sync::Arc;
use std::thread;

use super::super::state::{Inner, notify_queue_listeners};
use super::super::worker_utils::{
    append_job_log_line, current_time_millis, mark_batch_compress_child_processed,
};
use super::super::{job_runner, transcode_activity};
use super::selection::next_job_for_worker_locked;
use crate::ffui_core::domain::JobStatus;
use crate::sync_ext::{CondvarExt, MutexExt};

/// Spawn (or extend) worker threads to satisfy current concurrency settings.
pub(in crate::ffui_core::engine) fn spawn_worker(inner: Arc<Inner>) {
    #[cfg(test)]
    {
        if std::env::var_os("FFUI_ENABLE_WORKERS_IN_TESTS").is_none() {
            return;
        }
    }

    let mut state = inner.state.lock_unpoisoned();
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
        let result = thread::Builder::new()
            .name(format!("ffui-transcode-worker-{index}"))
            .spawn(move || worker_loop(inner_clone))
            .map(|_| ());
        if let Err(err) = result {
            crate::debug_eprintln!("failed to spawn transcoding worker thread: {err}");
            break;
        }
        state.spawned_workers += 1;
    }
}

/// Worker loop: wait for jobs, process, handle cancellation/errors.
fn worker_loop(inner: Arc<Inner>) {
    loop {
        let job_id = {
            let mut state = inner.state.lock_unpoisoned();
            loop {
                while state.queue.is_empty() {
                    state = inner.cv.wait_unpoisoned(state);
                }

                if let Some(id) = next_job_for_worker_locked(&mut state) {
                    break id;
                }

                // Queue is non-empty but no job is currently eligible (e.g. all
                // jobs are blocked behind an active input). Wait until either a
                // worker finishes or a queue mutation makes progress possible.
                state = inner.cv.wait_unpoisoned(state);
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
                let mut state = inner.state.lock_unpoisoned();
                if let Some(job) = state.jobs.get_mut(&job_id) {
                    job.status = JobStatus::Failed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
                    let reason = format!("Transcode failed: {err:#}");
                    job.failure_reason = Some(reason.clone());
                    append_job_log_line(job, reason);
                }
            }
            mark_batch_compress_child_processed(&inner, &job_id);
        }

        {
            let mut state = inner.state.lock_unpoisoned();
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
