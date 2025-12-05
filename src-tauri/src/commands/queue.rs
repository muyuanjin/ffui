//! Queue management commands.
//!
//! Provides commands for managing the transcoding job queue:
//! - Getting queue state
//! - Enqueueing new jobs
//! - Canceling, pausing, resuming, and restarting jobs
//! - Reordering jobs in the queue

use tauri::State;

use crate::ffui_core::{JobSource, JobType, QueueState, TranscodeJob, TranscodingEngine};

/// Get the current state of the transcoding queue.
#[tauri::command]
pub fn get_queue_state(engine: State<TranscodingEngine>) -> QueueState {
    engine.queue_state()
}

/// Enqueue a new transcoding job.
#[tauri::command]
pub fn enqueue_transcode_job(
    engine: State<TranscodingEngine>,
    filename: String,
    job_type: JobType,
    source: JobSource,
    original_size_mb: f64,
    original_codec: Option<String>,
    preset_id: String,
) -> TranscodeJob {
    engine.enqueue_transcode_job(
        filename,
        job_type,
        source,
        original_size_mb,
        original_codec,
        preset_id,
    )
}

/// Cancel a transcode job by ID.
#[tauri::command]
pub fn cancel_transcode_job(engine: State<TranscodingEngine>, job_id: String) -> bool {
    engine.cancel_job(&job_id)
}

/// Pause a transcode job by ID.
#[tauri::command]
pub fn wait_transcode_job(engine: State<TranscodingEngine>, job_id: String) -> bool {
    engine.wait_job(&job_id)
}

/// Resume a paused transcode job by ID.
#[tauri::command]
pub fn resume_transcode_job(engine: State<TranscodingEngine>, job_id: String) -> bool {
    engine.resume_job(&job_id)
}

/// Restart a transcode job by ID.
#[tauri::command]
pub fn restart_transcode_job(engine: State<TranscodingEngine>, job_id: String) -> bool {
    engine.restart_job(&job_id)
}

/// Reorder jobs in the queue by their IDs.
#[tauri::command]
pub fn reorder_queue(engine: State<TranscodingEngine>, ordered_ids: Vec<String>) -> bool {
    engine.reorder_waiting_jobs(ordered_ids)
}
