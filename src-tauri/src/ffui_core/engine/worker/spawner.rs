use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::thread;

use super::super::state::{Inner, notify_queue_listeners};
use super::super::worker_utils::{
    append_job_log_line, current_time_millis, mark_batch_compress_child_processed,
};
use super::super::{job_runner, transcode_activity};
use super::handoff::finish_job_and_try_start_next_locked;
use super::selection::next_job_for_worker_locked;
use crate::ffui_core::domain::JobStatus;
use crate::sync_ext::{CondvarExt, MutexExt};

/// Spawn (or extend) worker threads to satisfy current concurrency settings.
pub(in crate::ffui_core::engine) fn spawn_worker(inner: &Arc<Inner>) {
    #[cfg(test)]
    {
        if std::env::var_os("FFUI_ENABLE_WORKERS_IN_TESTS").is_none() {
            return;
        }
    }

    let (start_index, desired) = {
        let state = inner.state.lock_unpoisoned();
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
        (state.spawned_workers, desired)
    };

    let mut spawned = 0usize;
    for index in start_index..desired {
        let inner_clone = inner.clone();
        let result = thread::Builder::new()
            .name(format!("ffui-transcode-worker-{index}"))
            .spawn(move || worker_loop(&inner_clone))
            .map(|_| ());
        if let Err(err) = result {
            crate::debug_eprintln!("failed to spawn transcoding worker thread: {err}");
            break;
        }
        spawned += 1;
    }

    if spawned > 0 {
        let mut state = inner.state.lock_unpoisoned();
        state.spawned_workers = state.spawned_workers.max(start_index + spawned);
    }
}

/// Worker loop: wait for jobs, process, handle cancellation/errors.
fn worker_loop(inner: &Arc<Inner>) {
    let mut handoff_job_id: Option<String> = None;
    loop {
        let (job_id, should_notify_processing_start) = if let Some(id) = handoff_job_id.take() {
            (id, false)
        } else {
            let id = {
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
            (id, true)
        };

        // Mark today's transcode activity buckets as soon as a job enters
        // processing state so sparse/no-progress jobs still show activity.
        transcode_activity::record_processing_activity(inner);

        // Notify listeners that a job has moved into processing state.
        if should_notify_processing_start {
            notify_queue_listeners(inner);
        }

        // Call the job runner to process the transcode job
        let result = guarded_job_runner(|| job_runner::process_transcode_job(inner, &job_id));
        if let Err(reason) = result {
            {
                let mut state = inner.state.lock_unpoisoned();
                if let Some(job) = state.jobs.get_mut(&job_id) {
                    job.status = JobStatus::Failed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
                    job.failure_reason = Some(reason.clone());
                    append_job_log_line(job, reason);
                }
            }
            mark_batch_compress_child_processed(inner, &job_id);
        }

        let next_job = {
            let mut state = inner.state.lock_unpoisoned();
            finish_job_and_try_start_next_locked(&mut state, &job_id)
        };

        // Broadcast final state for the completed / failed / skipped job, and
        // include the next processing job when we can handoff immediately.
        notify_queue_listeners(inner);
        // Wake any worker threads waiting for a previously blocked input.
        inner.cv.notify_all();

        handoff_job_id = next_job;
    }
}

fn guarded_job_runner<F>(f: F) -> Result<(), String>
where
    F: FnOnce() -> anyhow::Result<()> + std::panic::UnwindSafe,
{
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(err)) => Err(format!("Transcode failed: {err:#}")),
        Err(payload) => Err(format!(
            "Transcode panicked: {}",
            panic_payload_to_string(&*payload)
        )),
    }
}

fn panic_payload_to_string(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        return (*s).to_string();
    }
    if let Some(s) = payload.downcast_ref::<String>() {
        return s.clone();
    }
    "unknown panic payload".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guarded_job_runner_turns_panics_into_errors() {
        let result = guarded_job_runner(|| -> anyhow::Result<()> {
            panic!("boom");
        });
        let msg = result.expect_err("expected panic to be converted into error");
        assert!(
            msg.contains("Transcode panicked: boom"),
            "expected panic message to be captured, got: {msg}"
        );
    }
}
