use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use super::*;

fn make_manual_job(id: &str, status: JobStatus) -> TranscodeJob {
    TranscodeJob {
        id: id.to_string(),
        filename: format!("C:/videos/{id}.mp4"),
        job_type: JobType::Video,
        source: JobSource::Manual,
        queue_order: None,
        original_size_mb: 10.0,
        original_codec: Some("h264".to_string()),
        preset_id: "preset-1".to_string(),
        status,
        progress: 0.0,
        start_time: Some(current_time_millis()),
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        logs: Vec::new(),
        log_head: None,
        skip_reason: None,
        input_path: Some(format!("C:/videos/{id}.mp4")),
        created_time_ms: None,
        modified_time_ms: None,
        output_path: Some(format!("C:/videos/{id}.compressed.mp4")),
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
        batch_compress_saving_condition: None,
        wait_metadata: None,
    }
}

fn make_batch_compress_media_child(id: &str, status: JobStatus, job_type: JobType) -> TranscodeJob {
    let mut job = make_manual_job(id, status);
    job.job_type = job_type;
    job.source = JobSource::BatchCompress;
    job.batch_id = Some("batch-resume-media".to_string());
    job
}

#[test]
fn bulk_cancel_notifies_once_and_updates_state() {
    let engine = make_engine_with_preset();

    let queued_id = "job-bulk-cancel-queued".to_string();
    let paused_id = "job-bulk-cancel-paused".to_string();
    let processing_id = "job-bulk-cancel-processing".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            queued_id.clone(),
            make_manual_job(&queued_id, JobStatus::Queued),
        );
        state.queue.push_back(queued_id.clone());
        state.jobs.insert(
            paused_id.clone(),
            make_manual_job(&paused_id, JobStatus::Paused),
        );
        state.queue.push_back(paused_id.clone());
        state.jobs.insert(
            processing_id.clone(),
            make_manual_job(&processing_id, JobStatus::Processing),
        );
        state.active_jobs.insert(processing_id.clone());
        state
            .active_inputs
            .insert(format!("C:/videos/{processing_id}.mp4"));
    }

    let notify_calls = TestArc::new(AtomicUsize::new(0));
    let notify_calls_clone = notify_calls.clone();
    engine.register_queue_lite_listener(move |_| {
        notify_calls_clone.fetch_add(1, Ordering::SeqCst);
    });

    let before = notify_calls.load(Ordering::SeqCst);
    assert!(
        engine.cancel_jobs_bulk(vec![
            queued_id.clone(),
            paused_id.clone(),
            processing_id.clone()
        ]),
        "cancel_jobs_bulk must succeed for queued/paused/processing jobs",
    );
    let after = notify_calls.load(Ordering::SeqCst);
    assert_eq!(after, before + 1, "bulk cancel must notify exactly once");

    let state = engine.inner.state.lock_unpoisoned();
    assert!(
        state.cancelled_jobs.contains(&processing_id),
        "processing job should be marked for cooperative cancel",
    );
    let queued = state.jobs.get(&queued_id).expect("queued job exists");
    assert_eq!(
        queued.status,
        JobStatus::Cancelled,
        "queued job should be cancelled"
    );
    let paused = state.jobs.get(&paused_id).expect("paused job exists");
    assert_eq!(
        paused.status,
        JobStatus::Cancelled,
        "paused job should be cancelled"
    );
}

#[test]
fn bulk_resume_keeps_batch_compress_media_children_in_worker_queue() {
    let engine = make_engine_with_preset();

    let paused_image = "job-bulk-resume-batch-image".to_string();
    let queued_audio = "job-bulk-resume-batch-audio".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            paused_image.clone(),
            make_batch_compress_media_child(&paused_image, JobStatus::Paused, JobType::Image),
        );
        state.jobs.insert(
            queued_audio.clone(),
            make_batch_compress_media_child(&queued_audio, JobStatus::Queued, JobType::Audio),
        );
        state
            .active_batch_compress_media_jobs
            .insert(paused_image.clone());
        state
            .active_batch_compress_media_jobs
            .insert(queued_audio.clone());
        state.queue.push_back(paused_image.clone());
        state.queue.push_back(queued_audio.clone());
    }

    assert!(
        engine.resume_jobs_bulk(vec![paused_image.clone(), queued_audio.clone()]),
        "resume_jobs_bulk should accept Batch Compress media children",
    );

    let state = engine.inner.state.lock_unpoisoned();
    assert_eq!(
        state
            .jobs
            .get(&paused_image)
            .expect("image child exists")
            .status,
        JobStatus::Queued
    );
    assert_eq!(
        state
            .jobs
            .get(&queued_audio)
            .expect("audio child exists")
            .status,
        JobStatus::Queued
    );
    assert!(
        state.queue.iter().any(|id| id == &paused_image),
        "bulk resume must leave Batch Compress image children in the normal worker queue",
    );
    assert!(
        state.queue.iter().any(|id| id == &queued_audio),
        "bulk idempotent resume must keep Batch Compress audio children in the normal worker queue",
    );
}

#[test]
fn bulk_restart_enqueues_batch_compress_media_children() {
    let engine = make_engine_with_preset();

    let paused_image = "job-bulk-restart-batch-image".to_string();
    let failed_audio = "job-bulk-restart-batch-audio".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            paused_image.clone(),
            make_batch_compress_media_child(&paused_image, JobStatus::Paused, JobType::Image),
        );
        state.jobs.insert(
            failed_audio.clone(),
            make_batch_compress_media_child(&failed_audio, JobStatus::Failed, JobType::Audio),
        );
        state
            .active_batch_compress_media_jobs
            .insert(paused_image.clone());
        state.queue.push_back(paused_image.clone());
    }

    assert!(
        engine.restart_jobs_bulk(vec![paused_image.clone(), failed_audio.clone()]),
        "bulk restart should accept Batch Compress media children",
    );

    let state = engine.inner.state.lock_unpoisoned();
    assert_eq!(
        state
            .jobs
            .get(&paused_image)
            .expect("image child exists")
            .status,
        JobStatus::Queued
    );
    assert!(
        state.queue.iter().any(|id| id == &paused_image),
        "paused Batch Compress media children must enter the normal worker queue"
    );
    assert_eq!(
        state
            .jobs
            .get(&failed_audio)
            .expect("audio child exists")
            .status,
        JobStatus::Queued
    );
    assert!(
        state.queue.iter().any(|id| id == &failed_audio),
        "bulk restart must queue failed Batch Compress media children for normal workers"
    );
}

#[test]
fn bulk_restart_reopens_processed_batch_compress_media_child_accounting() {
    let engine = make_engine_with_preset();
    let batch_id = "batch-resume-media".to_string();
    let failed_image = "job-bulk-restart-reopen-batch-image".to_string();
    let progress_snapshots = Arc::new(Mutex::new(Vec::<AutoCompressProgress>::new()));
    let progress_snapshots_for_listener = Arc::clone(&progress_snapshots);
    engine.register_batch_compress_listener(move |progress| {
        progress_snapshots_for_listener
            .lock()
            .expect("progress snapshots lock")
            .push(progress);
    });

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let mut batch = BatchCompressBatch::new(batch_id.clone(), "C:/videos".to_string(), 1);
        batch.status = BatchCompressBatchStatus::Completed;
        batch.total_candidates = 1;
        batch.total_processed = 1;
        batch.child_job_ids.push(failed_image.clone());
        batch.processed_child_job_ids.insert(failed_image.clone());
        batch.completed_at_ms = Some(current_time_millis());
        state.batch_compress_batches.insert(batch_id, batch);
        state.jobs.insert(
            failed_image.clone(),
            make_batch_compress_media_child(&failed_image, JobStatus::Failed, JobType::Image),
        );
    }

    assert!(
        engine.restart_jobs_bulk(vec![failed_image.clone()]),
        "bulk restart should accept failed Batch Compress media children",
    );

    let state = engine.inner.state.lock_unpoisoned();
    let batch = state
        .batch_compress_batches
        .get("batch-resume-media")
        .expect("batch should exist");
    assert_eq!(batch.status, BatchCompressBatchStatus::Running);
    assert_eq!(batch.total_candidates, 1);
    assert_eq!(batch.total_processed, 0);
    assert!(
        !batch.processed_child_job_ids.contains(&failed_image),
        "bulk restart must clear the prior processed marker so the rerun can count when it finishes",
    );
    let snapshots = progress_snapshots
        .lock()
        .expect("progress snapshots lock")
        .clone();
    let progress = snapshots
        .last()
        .expect("bulk restart must publish a Batch Compress progress snapshot");
    assert_eq!(progress.batch_id, "batch-resume-media");
    assert_eq!(
        progress.total_processed, 0,
        "frontend observers must see bulk restart reduce totalProcessed",
    );
    assert_eq!(progress.completed_at_ms, 0);
}

#[test]
fn bulk_restart_accepts_processing_media_child_owned_by_worker() {
    let engine = make_engine_with_preset();

    let processing_image = "job-bulk-restart-active-batch-image".to_string();
    let failed_manual = "job-bulk-restart-active-failed-manual".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            processing_image.clone(),
            make_batch_compress_media_child(
                &processing_image,
                JobStatus::Processing,
                JobType::Image,
            ),
        );
        state
            .active_batch_compress_media_jobs
            .insert(processing_image.clone());

        let mut failed = make_manual_job(&failed_manual, JobStatus::Failed);
        failed.progress = 100.0;
        failed.failure_reason = Some("boom".to_string());
        state.jobs.insert(failed_manual.clone(), failed);
    }

    let notify_calls = TestArc::new(AtomicUsize::new(0));
    let notify_calls_clone = notify_calls.clone();
    engine.register_queue_lite_listener(move |_| {
        notify_calls_clone.fetch_add(1, Ordering::SeqCst);
    });

    let before = notify_calls.load(Ordering::SeqCst);
    assert!(
        engine.restart_jobs_bulk(vec![processing_image.clone(), failed_manual.clone()]),
        "bulk restart should accept processing Batch Compress media children"
    );
    let after = notify_calls.load(Ordering::SeqCst);
    assert_eq!(
        after,
        before + 1,
        "accepted bulk restart must notify optimistic frontend state once"
    );

    let state = engine.inner.state.lock_unpoisoned();
    let image = state
        .jobs
        .get(&processing_image)
        .expect("image child exists");
    assert_eq!(image.status, JobStatus::Processing);
    assert!(state.restart_requests.contains(&processing_image));
    assert!(state.cancelled_jobs.contains(&processing_image));

    let failed = state.jobs.get(&failed_manual).expect("failed job exists");
    assert_eq!(failed.status, JobStatus::Queued);
    assert_eq!(failed.progress, 0.0);
    assert!(failed.failure_reason.is_none());
    assert!(!state.restart_requests.contains(&failed_manual));
    assert!(!state.cancelled_jobs.contains(&failed_manual));
}

#[test]
fn bulk_resume_notifies_once_and_restores_queue_entries() {
    let engine = make_engine_with_preset();

    let paused_a = "job-bulk-resume-a".to_string();
    let paused_b = "job-bulk-resume-b".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            paused_a.clone(),
            make_manual_job(&paused_a, JobStatus::Paused),
        );
        state.jobs.insert(
            paused_b.clone(),
            make_manual_job(&paused_b, JobStatus::Paused),
        );
    }

    let notify_calls = TestArc::new(AtomicUsize::new(0));
    let notify_calls_clone = notify_calls.clone();
    engine.register_queue_lite_listener(move |_| {
        notify_calls_clone.fetch_add(1, Ordering::SeqCst);
    });

    let before = notify_calls.load(Ordering::SeqCst);
    assert!(
        engine.resume_jobs_bulk(vec![paused_a.clone(), paused_b.clone()]),
        "resume_jobs_bulk must succeed for paused jobs",
    );
    let after = notify_calls.load(Ordering::SeqCst);
    assert_eq!(after, before + 1, "bulk resume must notify exactly once");

    let state = engine.inner.state.lock_unpoisoned();
    let a = state.jobs.get(&paused_a).expect("job exists");
    let b = state.jobs.get(&paused_b).expect("job exists");
    assert_eq!(a.status, JobStatus::Queued);
    assert_eq!(b.status, JobStatus::Queued);
    assert!(
        state.queue.iter().any(|id| id == &paused_a),
        "resumed job should be enqueued",
    );
    assert!(
        state.queue.iter().any(|id| id == &paused_b),
        "resumed job should be enqueued",
    );
}

#[test]
fn bulk_restart_notifies_once_and_resets_non_processing_jobs() {
    let engine = make_engine_with_preset();

    let processing_id = "job-bulk-restart-processing".to_string();
    let failed_id = "job-bulk-restart-failed".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            processing_id.clone(),
            make_manual_job(&processing_id, JobStatus::Processing),
        );
        state.active_jobs.insert(processing_id.clone());
        state
            .active_inputs
            .insert(format!("C:/videos/{processing_id}.mp4"));

        let mut failed = make_manual_job(&failed_id, JobStatus::Failed);
        failed.progress = 100.0;
        failed.failure_reason = Some("boom".to_string());
        state.jobs.insert(failed_id.clone(), failed);
    }

    let notify_calls = TestArc::new(AtomicUsize::new(0));
    let notify_calls_clone = notify_calls.clone();
    engine.register_queue_lite_listener(move |_| {
        notify_calls_clone.fetch_add(1, Ordering::SeqCst);
    });

    let before = notify_calls.load(Ordering::SeqCst);
    assert!(
        engine.restart_jobs_bulk(vec![processing_id.clone(), failed_id.clone()]),
        "restart_jobs_bulk must succeed for processing + failed jobs",
    );
    let after = notify_calls.load(Ordering::SeqCst);
    assert_eq!(after, before + 1, "bulk restart must notify exactly once");

    let state = engine.inner.state.lock_unpoisoned();
    assert!(
        state.restart_requests.contains(&processing_id),
        "processing job should be marked for restart",
    );
    assert!(
        state.cancelled_jobs.contains(&processing_id),
        "processing job should be marked for cooperative cancel",
    );

    let failed = state.jobs.get(&failed_id).expect("failed job exists");
    assert_eq!(failed.status, JobStatus::Queued);
    assert_eq!(failed.progress, 0.0);
    assert!(failed.failure_reason.is_none());
}

#[test]
fn bulk_cancel_ignores_terminal_jobs_and_cancels_processing() {
    let engine = make_engine_with_preset();

    let processing_id = "job-bulk-cancel-ignores-terminal-processing".to_string();
    let completed_id = "job-bulk-cancel-ignores-terminal-completed".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            processing_id.clone(),
            make_manual_job(&processing_id, JobStatus::Processing),
        );
        state.active_jobs.insert(processing_id.clone());
        state
            .active_inputs
            .insert(format!("C:/videos/{processing_id}.mp4"));

        state.jobs.insert(
            completed_id.clone(),
            make_manual_job(&completed_id, JobStatus::Completed),
        );
    }

    assert!(
        engine.cancel_jobs_bulk(vec![processing_id.clone(), completed_id.clone()]),
        "cancel_jobs_bulk should succeed even if some jobs are already terminal",
    );

    let state = engine.inner.state.lock_unpoisoned();
    assert!(
        state.cancelled_jobs.contains(&processing_id),
        "processing job should be marked for cooperative cancel",
    );
    let completed = state.jobs.get(&completed_id).expect("job exists");
    assert_eq!(completed.status, JobStatus::Completed);
}

#[test]
fn bulk_resume_ignores_non_paused_jobs_and_resumes_paused() {
    let engine = make_engine_with_preset();

    let paused_id = "job-bulk-resume-ignores-processing-paused".to_string();
    let processing_id = "job-bulk-resume-ignores-processing-processing".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            paused_id.clone(),
            make_manual_job(&paused_id, JobStatus::Paused),
        );
        state.jobs.insert(
            processing_id.clone(),
            make_manual_job(&processing_id, JobStatus::Processing),
        );
        state.active_jobs.insert(processing_id.clone());
        state
            .active_inputs
            .insert(format!("C:/videos/{processing_id}.mp4"));
    }

    assert!(
        engine.resume_jobs_bulk(vec![paused_id.clone(), processing_id.clone()]),
        "resume_jobs_bulk should succeed even if some jobs are not paused",
    );

    let state = engine.inner.state.lock_unpoisoned();
    let paused = state.jobs.get(&paused_id).expect("job exists");
    assert_eq!(paused.status, JobStatus::Queued);
    let processing = state.jobs.get(&processing_id).expect("job exists");
    assert_eq!(processing.status, JobStatus::Processing);
}

#[test]
fn bulk_restart_ignores_completed_jobs_and_restarts_failed() {
    let engine = make_engine_with_preset();

    let failed_id = "job-bulk-restart-ignores-completed-failed".to_string();
    let completed_id = "job-bulk-restart-ignores-completed-completed".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let mut failed = make_manual_job(&failed_id, JobStatus::Failed);
        failed.progress = 100.0;
        failed.failure_reason = Some("boom".to_string());
        state.jobs.insert(failed_id.clone(), failed);

        state.jobs.insert(
            completed_id.clone(),
            make_manual_job(&completed_id, JobStatus::Completed),
        );
    }

    assert!(
        engine.restart_jobs_bulk(vec![failed_id.clone(), completed_id.clone()]),
        "restart_jobs_bulk should succeed even if some jobs are ineligible",
    );

    let state = engine.inner.state.lock_unpoisoned();
    let failed = state.jobs.get(&failed_id).expect("job exists");
    assert_eq!(failed.status, JobStatus::Queued);
    assert_eq!(failed.progress, 0.0);
    assert!(failed.failure_reason.is_none());

    let completed = state.jobs.get(&completed_id).expect("job exists");
    assert_eq!(completed.status, JobStatus::Completed);
}
