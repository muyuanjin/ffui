//! Worker orchestration: fan-out to specialized submodules for spawning,
//! job selection, enqueue, and queue control.

mod control;
mod enqueue;
mod selection;
mod spawner;
mod worker_reorder;

pub(super) use control::{
    cancel_job, delete_job, delete_smart_scan_batch, restart_job, resume_job, wait_job,
};
pub(super) use enqueue::{enqueue_transcode_job, enqueue_transcode_jobs};
#[cfg(test)]
pub(super) use selection::next_job_for_worker_locked;
pub(super) use spawner::spawn_worker;
pub(super) use worker_reorder::reorder_waiting_jobs;
