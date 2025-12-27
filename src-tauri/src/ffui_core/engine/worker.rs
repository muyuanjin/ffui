//! Worker orchestration: fan-out to specialized submodules for spawning,
//! job selection, enqueue, and queue control.

mod cleanup;
mod control;
mod crash_recovery_probe;
mod enqueue;
mod handoff;
mod selection;
mod spawner;
mod worker_reorder;

pub(super) use control::{
    cancel_job, cancel_jobs_bulk, delete_batch_compress_batch, delete_batch_compress_batches_bulk,
    delete_job, delete_jobs_bulk, restart_job, restart_jobs_bulk, resume_job, resume_jobs_bulk,
    resume_startup_auto_paused_jobs, wait_job, wait_jobs_bulk,
};
pub(super) use enqueue::{enqueue_transcode_job, enqueue_transcode_jobs};
#[cfg(test)]
pub(super) use handoff::finish_job_and_try_start_next_locked;
#[cfg(test)]
pub(super) use selection::next_job_for_worker_locked;
pub(super) use spawner::spawn_worker;
pub(super) use worker_reorder::reorder_waiting_jobs;

#[cfg(test)]
pub(super) use crash_recovery_probe::probe_crash_recovery_wait_metadata_for_processing_job_best_effort;
