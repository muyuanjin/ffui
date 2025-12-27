//! Queue management commands.
//!
//! Provides commands for managing the transcoding job queue:
//! - Getting queue state
//! - Enqueueing new jobs
//! - Canceling, pausing, resuming, and restarting jobs
//! - Reordering jobs in the queue

use tauri::State;

use super::wait_for_queue_recovery;
use crate::ffui_core::input_expand::expand_manual_job_inputs as expand_manual_job_inputs_impl;
use crate::ffui_core::{
    JobSource, JobType, QueueStartupHint, QueueState, QueueStateLite, TranscodeJob,
    TranscodingEngine,
};
use crate::sync_ext::MutexExt;

fn infer_startup_hint_from_engine_state(engine: &TranscodingEngine) -> Option<QueueStartupHint> {
    // If a hint is already present, keep it.
    if let Some(existing) = engine.queue_startup_hint() {
        return Some(existing);
    }

    let paused_queue_ids: Vec<String> = {
        let state = engine.inner.state.lock_unpoisoned();
        state
            .queue
            .iter()
            .filter(|id| {
                state
                    .jobs
                    .get(*id)
                    .is_some_and(|job| job.status == crate::ffui_core::JobStatus::Paused)
            })
            .cloned()
            .collect()
    };

    let mut paused_ids = paused_queue_ids;
    if paused_ids.is_empty() {
        let state = engine.inner.state.lock_unpoisoned();
        let mut extra: Vec<String> = state
            .jobs
            .values()
            .filter(|job| job.status == crate::ffui_core::JobStatus::Paused)
            .map(|job| job.id.clone())
            .collect();
        extra.sort();
        paused_ids = extra;
    }

    if paused_ids.is_empty() {
        return None;
    }

    let previous_marker_kind = engine
        .inner
        .previous_shutdown_marker
        .lock_unpoisoned()
        .as_ref()
        .map(|m| m.kind);

    let kind = match previous_marker_kind {
        Some(crate::ffui_core::ShutdownMarkerKind::CleanAutoWait) => {
            crate::ffui_core::QueueStartupHintKind::PauseOnExit
        }
        Some(crate::ffui_core::ShutdownMarkerKind::Running) => {
            crate::ffui_core::QueueStartupHintKind::CrashOrKill
        }
        _ => crate::ffui_core::QueueStartupHintKind::PausedQueue,
    };

    let hint = QueueStartupHint {
        kind,
        auto_paused_job_count: paused_ids.len(),
    };

    {
        let mut guard = engine.inner.queue_startup_hint.lock_unpoisoned();
        *guard = Some(hint.clone());
    }
    {
        let mut guard = engine.inner.startup_auto_paused_job_ids.lock_unpoisoned();
        guard.extend(paused_ids);
    }

    Some(hint)
}

/// Get the current state of the transcoding queue.
#[tauri::command]
pub fn get_queue_state(engine: State<'_, TranscodingEngine>) -> QueueState {
    engine.queue_state()
}

/// Get a lightweight snapshot of the transcoding queue without heavy fields
/// such as the full logs vector. This is intended for startup and frequent
/// updates where payload size matters more than full detail.
#[tauri::command]
pub fn get_queue_state_lite(engine: State<'_, TranscodingEngine>) -> QueueStateLite {
    engine.queue_state_lite()
}

#[tauri::command]
pub fn get_queue_startup_hint(engine: State<'_, TranscodingEngine>) -> Option<QueueStartupHint> {
    wait_for_queue_recovery(&engine);
    infer_startup_hint_from_engine_state(&engine)
}

#[tauri::command]
pub fn resume_startup_queue(engine: State<'_, TranscodingEngine>) -> usize {
    wait_for_queue_recovery(&engine);
    let resumed = engine.resume_startup_auto_paused_jobs();
    engine.clear_queue_startup_hint();
    resumed
}

#[tauri::command]
pub fn dismiss_queue_startup_hint(engine: State<'_, TranscodingEngine>) {
    wait_for_queue_recovery(&engine);
    engine.clear_queue_startup_hint();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_ext::MutexExt;
    use std::sync::atomic::Ordering;

    #[test]
    fn get_queue_startup_hint_infers_from_paused_queue_when_missing() {
        let engine = TranscodingEngine::new_for_tests();
        engine
            .inner
            .queue_recovery_done
            .store(true, Ordering::Release);
        engine.inner.cv.notify_all();

        {
            let mut state = engine.inner.state.lock_unpoisoned();
            state.queue.push_back("job-1".to_string());
            state.jobs.insert(
                "job-1".to_string(),
                TranscodeJob {
                    id: "job-1".to_string(),
                    filename: "C:/videos/job-1.mp4".to_string(),
                    job_type: JobType::Video,
                    source: JobSource::Manual,
                    queue_order: None,
                    original_size_mb: 0.0,
                    original_codec: None,
                    preset_id: "preset-1".to_string(),
                    status: crate::ffui_core::JobStatus::Paused,
                    progress: 0.0,
                    start_time: None,
                    end_time: None,
                    processing_started_ms: None,
                    elapsed_ms: None,
                    output_size_mb: None,
                    logs: Vec::new(),
                    log_head: None,
                    skip_reason: None,
                    input_path: None,
                    output_path: None,
                    output_policy: None,
                    ffmpeg_command: None,
                    runs: Vec::new(),
                    media_info: None,
                    estimated_seconds: None,
                    preview_path: None,
                    preview_revision: 0,
                    log_tail: None,
                    failure_reason: None,
                    warnings: Vec::new(),
                    batch_id: None,
                    wait_metadata: None,
                },
            );
        }

        let hint = infer_startup_hint_from_engine_state(&engine).expect("expected a hint");
        assert_eq!(
            hint.kind,
            crate::ffui_core::QueueStartupHintKind::PausedQueue
        );
        assert_eq!(hint.auto_paused_job_count, 1);
    }
}

/// Enqueue a new transcoding job.
#[tauri::command]
pub async fn enqueue_transcode_job(
    engine: State<'_, TranscodingEngine>,
    filename: String,
    job_type: JobType,
    source: JobSource,
    original_size_mb: f64,
    original_codec: Option<String>,
    preset_id: String,
) -> Result<TranscodeJob, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.enqueue_transcode_job(
            filename,
            job_type,
            source,
            original_size_mb,
            original_codec,
            preset_id,
        )
    })
    .await
    .map_err(|e| format!("failed to join enqueue_transcode_job task: {e}"))
}

/// Enqueue multiple transcoding jobs as a single batch.
#[tauri::command]
pub async fn enqueue_transcode_jobs(
    engine: State<'_, TranscodingEngine>,
    filenames: Vec<String>,
    job_type: JobType,
    source: JobSource,
    original_size_mb: f64,
    original_codec: Option<String>,
    preset_id: String,
) -> Result<Vec<TranscodeJob>, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.enqueue_transcode_jobs(
            filenames,
            job_type,
            source,
            original_size_mb,
            original_codec,
            preset_id,
        )
    })
    .await
    .map_err(|e| format!("failed to join enqueue_transcode_jobs task: {e}"))
}

/// Expand user-selected or dropped paths into an ordered list of transcodable
/// input files for manual queue enqueuing.
///
/// This prevents directory paths (or unsupported files) from being enqueued as
/// invalid jobs while preserving the input order reported by the OS picker /
/// drag-drop payload.
#[tauri::command]
pub async fn expand_manual_job_inputs(
    paths: Vec<String>,
    recursive: bool,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || expand_manual_job_inputs_impl(&paths, recursive))
        .await
        .map_err(|e| format!("failed to join expand_manual_job_inputs task: {e}"))
}

/// Cancel a transcode job by ID.
#[tauri::command]
pub fn cancel_transcode_job(engine: State<'_, TranscodingEngine>, job_id: String) -> bool {
    engine.cancel_job(&job_id)
}

/// Pause a transcode job by ID.
#[tauri::command]
pub fn wait_transcode_job(engine: State<'_, TranscodingEngine>, job_id: String) -> bool {
    engine.wait_job(&job_id)
}

/// Pause multiple transcode jobs in one atomic operation.
#[tauri::command]
pub fn wait_transcode_jobs_bulk(
    engine: State<'_, TranscodingEngine>,
    job_ids: Vec<String>,
) -> bool {
    engine.wait_jobs_bulk(job_ids)
}

/// Resume a paused transcode job by ID.
#[tauri::command]
pub fn resume_transcode_job(engine: State<'_, TranscodingEngine>, job_id: String) -> bool {
    engine.resume_job(&job_id)
}

/// Restart a transcode job by ID.
#[tauri::command]
pub fn restart_transcode_job(engine: State<'_, TranscodingEngine>, job_id: String) -> bool {
    engine.restart_job(&job_id)
}

/// Permanently delete a transcode job by ID.
///
/// Only jobs that are already in a terminal state (completed/failed/skipped/
/// cancelled) are eligible for deletion; active jobs remain protected.
#[tauri::command]
pub fn delete_transcode_job(engine: State<'_, TranscodingEngine>, job_id: String) -> bool {
    engine.delete_job(&job_id)
}

/// Permanently delete all Batch Compress child jobs that belong to a given batch.
///
/// 前端在“复合任务（Batch Compress 批次）→ 从列表删除”时，会优先调用该命令以确保
/// 整个批次一次性从队列中清理，而不是逐个 `delete_transcode_job`。
#[tauri::command]
pub fn delete_batch_compress_batch(engine: State<'_, TranscodingEngine>, batch_id: String) -> bool {
    engine.delete_batch_compress_batch(&batch_id)
}

/// Reorder jobs in the queue by their IDs.
#[tauri::command]
pub fn reorder_queue(engine: State<'_, TranscodingEngine>, ordered_ids: Vec<String>) -> bool {
    engine.reorder_waiting_jobs(ordered_ids)
}

/// Fetch full details for a single job, including logs and media metadata.
#[tauri::command]
pub fn get_job_detail(
    engine: State<'_, TranscodingEngine>,
    job_id: String,
) -> Option<TranscodeJob> {
    engine.job_detail(&job_id)
}
