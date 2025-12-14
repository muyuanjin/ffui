//! Queue management commands.
//!
//! Provides commands for managing the transcoding job queue:
//! - Getting queue state
//! - Enqueueing new jobs
//! - Canceling, pausing, resuming, and restarting jobs
//! - Reordering jobs in the queue

use tauri::State;

use crate::ffui_core::input_expand::expand_manual_job_inputs as expand_manual_job_inputs_impl;
use crate::ffui_core::{
    JobSource, JobType, QueueState, QueueStateLite, TranscodeJob, TranscodingEngine,
};

/// Get the current state of the transcoding queue.
#[tauri::command]
pub fn get_queue_state(engine: State<TranscodingEngine>) -> QueueState {
    engine.queue_state()
}

/// Get a lightweight snapshot of the transcoding queue without heavy fields
/// such as the full logs vector. This is intended for startup and frequent
/// updates where payload size matters more than full detail.
#[tauri::command]
pub fn get_queue_state_lite(engine: State<TranscodingEngine>) -> QueueStateLite {
    engine.queue_state_lite()
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

/// Expand user-selected or dropped paths into an ordered list of transcodable
/// input files for manual queue enqueuing.
///
/// This prevents directory paths (or unsupported files) from being enqueued as
/// invalid jobs while preserving the input order reported by the OS picker /
/// drag-drop payload.
#[tauri::command]
pub fn expand_manual_job_inputs(paths: Vec<String>, recursive: bool) -> Vec<String> {
    expand_manual_job_inputs_impl(&paths, recursive)
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

/// Permanently delete a transcode job by ID.
///
/// Only jobs that are already in a terminal state (completed/failed/skipped/
/// cancelled) are eligible for deletion; active jobs remain protected.
#[tauri::command]
pub fn delete_transcode_job(engine: State<TranscodingEngine>, job_id: String) -> bool {
    engine.delete_job(&job_id)
}

/// Permanently delete all Smart Scan child jobs that belong to a given batch.
///
/// 前端在“复合任务（Smart Scan 批次）→ 从列表删除”时，会优先调用该命令以确保
/// 整个批次一次性从队列中清理，而不是逐个 delete_transcode_job。
#[tauri::command]
pub fn delete_smart_scan_batch(engine: State<TranscodingEngine>, batch_id: String) -> bool {
    engine.delete_smart_scan_batch(&batch_id)
}

/// Reorder jobs in the queue by their IDs.
#[tauri::command]
pub fn reorder_queue(engine: State<TranscodingEngine>, ordered_ids: Vec<String>) -> bool {
    engine.reorder_waiting_jobs(ordered_ids)
}

/// Fetch full details for a single job, including logs and media metadata.
#[tauri::command]
pub fn get_job_detail(engine: State<TranscodingEngine>, job_id: String) -> Option<TranscodeJob> {
    engine.job_detail(&job_id)
}
