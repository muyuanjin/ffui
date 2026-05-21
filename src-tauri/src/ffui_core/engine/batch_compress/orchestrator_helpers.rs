use std::fs;
use std::path::Path;

use super::super::state::{EngineState, Inner, notify_batch_compress_listeners};
use super::helpers::{make_batch_compress_job, replace_original_output_policy};
use crate::ffui_core::domain::{
    AutoCompressProgress, AutoCompressResult, BatchCompressConfig, JobType, TranscodeJob,
};
use crate::sync_ext::MutexExt;

pub(super) fn insert_batch_child_after_siblings(
    state: &mut EngineState,
    batch_id: &str,
    job_id: String,
    job: TranscodeJob,
) {
    state.jobs.insert(job_id.clone(), job);
    let insert_at = state
        .queue
        .iter()
        .enumerate()
        .filter_map(|(index, existing_id)| {
            state
                .jobs
                .get(existing_id)
                .is_some_and(|existing| existing.batch_id.as_deref() == Some(batch_id))
                .then_some(index + 1)
        })
        .next_back()
        .unwrap_or(state.queue.len());

    state.queue.insert(insert_at, job_id);
}

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
        output_policy: replace_original_output_policy(config),
        batch_id: batch_id.to_string(),
        saving_condition: config.into(),
        start_time: None,
    });

    insert_stub_job_into_queue(inner, job_id, batch_id, job);
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
        output_policy: replace_original_output_policy(config),
        batch_id: batch_id.to_string(),
        saving_condition: config.into(),
        start_time: None,
    });

    insert_stub_job_into_queue(inner, job_id, batch_id, job);
}

fn insert_stub_job_into_queue(inner: &Inner, job_id: &str, batch_id: &str, job: TranscodeJob) {
    let progress = {
        let mut state = inner.state.lock_unpoisoned();
        let job_id = job_id.to_string();
        let progress = {
            state.batch_compress_batches.get_mut(batch_id).map(|batch| {
                batch.total_candidates = batch.total_candidates.saturating_add(1);
                batch.child_job_ids.push(job_id.clone());
                AutoCompressProgress {
                    root_path: batch.root_path.clone(),
                    total_files_scanned: batch.total_files_scanned,
                    total_candidates: batch.total_candidates,
                    total_processed: batch.total_processed,
                    batch_id: batch.batch_id.clone(),
                    completed_at_ms: batch.completed_at_ms.unwrap_or(0),
                }
            })
        };
        insert_batch_child_after_siblings(&mut state, batch_id, job_id, job);
        progress
    };

    if let Some(progress) = progress {
        notify_batch_compress_listeners(inner, &progress);
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::ffui_core::domain::{BatchCompressConfig, JobStatus};
    use crate::ffui_core::engine::state::{BatchCompressBatch, BatchCompressBatchStatus, Inner};
    use crate::ffui_core::engine::worker::next_job_for_worker_locked;
    use crate::ffui_core::engine::worker_utils::{
        active_input_key, mark_batch_compress_child_processed,
    };
    use crate::ffui_core::settings::AppSettings;

    #[derive(Clone, Copy)]
    enum StubKind {
        Image,
        Audio,
    }

    #[test]
    fn media_stub_registration_is_visible_before_worker_selection() {
        assert_media_stub_registration_is_visible_before_worker_selection(StubKind::Image);
        assert_media_stub_registration_is_visible_before_worker_selection(StubKind::Audio);
    }

    fn assert_media_stub_registration_is_visible_before_worker_selection(kind: StubKind) {
        let dir = tempfile::tempdir().expect("temp dir");
        let (file_name, batch_id, job_id) = match kind {
            StubKind::Image => (
                "sample.png",
                "batch-image-stub-registration",
                "job-image-stub-registration",
            ),
            StubKind::Audio => (
                "sample.mp3",
                "batch-audio-stub-registration",
                "job-audio-stub-registration",
            ),
        };
        let input = dir.path().join(file_name);
        fs::write(&input, [0u8; 16]).expect("write media stub input");

        let inner = Arc::new(Inner::new(Vec::new(), AppSettings::default()));
        {
            let mut state = inner.state.lock_unpoisoned();
            state.batch_compress_batches.insert(
                batch_id.to_string(),
                BatchCompressBatch::new(
                    batch_id.to_string(),
                    dir.path().to_string_lossy().into_owned(),
                    1,
                ),
            );
        }

        match kind {
            StubKind::Image => {
                insert_image_stub_job(
                    &inner,
                    job_id,
                    &input,
                    &BatchCompressConfig::default(),
                    batch_id,
                );
            }
            StubKind::Audio => {
                insert_audio_stub_job(
                    &inner,
                    job_id,
                    &input,
                    &BatchCompressConfig::default(),
                    batch_id,
                );
            }
        }

        {
            let state = inner.state.lock_unpoisoned();
            let batch = state
                .batch_compress_batches
                .get(batch_id)
                .expect("batch should exist");
            assert_eq!(batch.total_candidates, 1);
            assert_eq!(batch.child_job_ids, vec![job_id.to_string()]);
            assert_eq!(batch.status, BatchCompressBatchStatus::Scanning);
            assert!(
                state.queue.iter().any(|queued| queued == job_id),
                "job must be queued after batch metadata is registered"
            );
        }

        let picked_while_scanning = {
            let mut state = inner.state.lock_unpoisoned();
            next_job_for_worker_locked(&mut state)
        };
        assert_eq!(
            picked_while_scanning, None,
            "stub should not be selectable until the batch scan has finished"
        );

        {
            let mut state = inner.state.lock_unpoisoned();
            let batch = state
                .batch_compress_batches
                .get_mut(batch_id)
                .expect("batch should exist");
            assert_eq!(batch.status, BatchCompressBatchStatus::Scanning);
            batch.status = BatchCompressBatchStatus::Running;
        }

        let picked_after_scan = {
            let mut state = inner.state.lock_unpoisoned();
            next_job_for_worker_locked(&mut state).expect("stub should be selectable after scan")
        };
        assert_eq!(picked_after_scan, job_id);

        {
            let mut state = inner.state.lock_unpoisoned();
            let input_key = {
                let job = state.jobs.get_mut(job_id).expect("picked job should exist");
                job.status = JobStatus::Completed;
                active_input_key(job).to_string()
            };
            state.active_jobs.remove(job_id);
            state.active_inputs.remove(&input_key);
        }
        mark_batch_compress_child_processed(&inner, job_id);

        let state = inner.state.lock_unpoisoned();
        let batch = state
            .batch_compress_batches
            .get(batch_id)
            .expect("batch should remain available");
        assert_eq!(batch.total_candidates, 1);
        assert_eq!(batch.total_processed, 1);
        assert_eq!(batch.status, BatchCompressBatchStatus::Completed);
    }
}
