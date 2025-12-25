use std::fs;
use std::path::Path;
use std::sync::Arc;

use super::super::state::{
    BatchCompressBatchStatus, Inner, update_batch_compress_batch_with_inner,
};
use super::super::worker_utils::{append_job_log_line, mark_batch_compress_child_processed};
use super::helpers::{current_time_millis, make_batch_compress_job, notify_queue_listeners};
use crate::ffui_core::domain::{AutoCompressResult, BatchCompressConfig, JobStatus, JobType};
use crate::sync_ext::MutexExt;

pub(super) fn insert_image_stub_job(
    inner: &Inner,
    job_id: &str,
    path: &Path,
    config: &BatchCompressConfig,
    batch_id: &str,
) {
    let original_size_mb = fs::metadata(path)
        .map(|m| m.len() as f64 / (1024.0 * 1024.0))
        .unwrap_or(0.0);

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();

    let original_codec = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);

    let job = make_batch_compress_job(super::helpers::BatchCompressJobSpec {
        job_id: job_id.to_string(),
        filename,
        job_type: JobType::Image,
        preset_id: config.video_preset_id.clone(),
        original_size_mb,
        original_codec,
        input_path: path.to_string_lossy().into_owned(),
        output_policy: config.output_policy.clone(),
        batch_id: batch_id.to_string(),
        start_time: None,
    });

    let mut state = inner.state.lock_unpoisoned();
    state.jobs.insert(job_id.to_string(), job);
}

pub(super) fn insert_audio_stub_job(
    inner: &Inner,
    job_id: &str,
    path: &Path,
    config: &BatchCompressConfig,
    batch_id: &str,
) {
    let original_size_bytes = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let original_size_mb = original_size_bytes as f64 / (1024.0 * 1024.0);

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);

    let job = make_batch_compress_job(super::helpers::BatchCompressJobSpec {
        job_id: job_id.to_string(),
        filename,
        job_type: JobType::Audio,
        preset_id: config.audio_preset_id.clone().unwrap_or_default(),
        original_size_mb,
        original_codec: ext,
        input_path: path.to_string_lossy().into_owned(),
        output_policy: config.output_policy.clone(),
        batch_id: batch_id.to_string(),
        start_time: None,
    });

    let mut state = inner.state.lock_unpoisoned();
    state.jobs.insert(job_id.to_string(), job);
}

pub(super) fn set_job_processing(inner: &Inner, job_id: &str) {
    let mut state = inner.state.lock_unpoisoned();
    if let Some(job) = state.jobs.get_mut(job_id) {
        job.status = JobStatus::Processing;
        job.start_time.get_or_insert_with(current_time_millis);
    }
}

pub(super) fn handle_media_worker_spawn_failure(
    inner: &Arc<Inner>,
    batch_id: &str,
    pending_job_ids: Vec<String>,
    err: std::io::Error,
) {
    update_batch_compress_batch_with_inner(inner, batch_id, true, |batch| {
        batch.status = BatchCompressBatchStatus::Failed;
        batch.completed_at_ms = Some(current_time_millis());
    });

    for job_id in pending_job_ids {
        let mut state = inner.state.lock_unpoisoned();
        if let Some(job) = state.jobs.get_mut(&job_id) {
            job.status = JobStatus::Failed;
            job.progress = 100.0;
            job.end_time = Some(current_time_millis());
            let reason = format!("Batch Compress worker thread could not be spawned: {err}");
            job.failure_reason = Some(reason.clone());
            append_job_log_line(job, reason);
        }
        drop(state);
        notify_queue_listeners(inner);
        mark_batch_compress_child_processed(inner, &job_id);
    }
}

#[allow(dead_code)]
pub(crate) fn batch_compress_batch_summary(
    inner: &Inner,
    batch_id: &str,
) -> Option<AutoCompressResult> {
    let (batch, jobs) = {
        let state = inner.state.lock_unpoisoned();
        let batch = state.batch_compress_batches.get(batch_id)?.clone();
        let jobs = state
            .jobs
            .values()
            .filter(|job| job.batch_id.as_deref() == Some(batch_id))
            .cloned()
            .collect::<Vec<_>>();
        (batch, jobs)
    };

    Some(AutoCompressResult {
        root_path: batch.root_path,
        jobs,
        total_files_scanned: batch.total_files_scanned,
        total_candidates: batch.total_candidates,
        total_processed: batch.total_processed,
        batch_id: batch.batch_id,
        started_at_ms: batch.started_at_ms,
        completed_at_ms: batch.completed_at_ms.unwrap_or(batch.started_at_ms),
    })
}
