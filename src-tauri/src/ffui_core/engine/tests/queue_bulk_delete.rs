use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;

#[test]
fn bulk_delete_jobs_removes_all_and_notifies_once() {
    let engine = make_engine_with_preset();

    let completed_id = "job-bulk-delete-completed".to_string();
    let failed_id = "job-bulk-delete-failed".to_string();

    let make_job = |id: &str, status: JobStatus| TranscodeJob {
        id: id.to_string(),
        filename: format!("C:/videos/{id}.mp4"),
        job_type: JobType::Video,
        source: JobSource::Manual,
        queue_order: None,
        original_size_mb: 10.0,
        original_codec: Some("h264".to_string()),
        preset_id: "preset-1".to_string(),
        status,
        progress: 100.0,
        start_time: Some(current_time_millis()),
        end_time: Some(current_time_millis()),
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: Some(5.0),
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
        wait_metadata: None,
    };

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            completed_id.clone(),
            make_job(&completed_id, JobStatus::Completed),
        );
        state
            .jobs
            .insert(failed_id.clone(), make_job(&failed_id, JobStatus::Failed));
        state.queue.push_back(completed_id.clone());
        state.queue.push_back(failed_id.clone());
    }

    let notify_calls = TestArc::new(AtomicUsize::new(0));
    let notify_calls_clone = notify_calls.clone();
    engine.register_queue_lite_listener(move |_| {
        notify_calls_clone.fetch_add(1, Ordering::SeqCst);
    });

    let before = notify_calls.load(Ordering::SeqCst);
    assert!(
        engine.delete_jobs_bulk(vec![completed_id.clone(), failed_id.clone()]),
        "delete_jobs_bulk must succeed for terminal jobs",
    );
    let after = notify_calls.load(Ordering::SeqCst);
    assert_eq!(
        after,
        before + 1,
        "bulk delete must notify queue listeners exactly once",
    );

    let snapshot = engine.queue_state();
    assert!(
        !snapshot
            .jobs
            .iter()
            .any(|job| job.id == completed_id || job.id == failed_id),
        "bulk delete should remove all jobs from queue state",
    );
}

#[test]
fn bulk_delete_jobs_ignores_non_terminal_jobs() {
    let engine = make_engine_with_preset();

    let completed_id = "job-bulk-delete-reject-completed".to_string();
    let queued_id = "job-bulk-delete-reject-queued".to_string();

    let make_job = |id: &str, status: JobStatus| TranscodeJob {
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
        wait_metadata: None,
    };

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            completed_id.clone(),
            make_job(&completed_id, JobStatus::Completed),
        );
        state
            .jobs
            .insert(queued_id.clone(), make_job(&queued_id, JobStatus::Queued));
        state.queue.push_back(queued_id.clone());
    }

    assert!(
        engine.delete_jobs_bulk(vec![completed_id.clone(), queued_id.clone()]),
        "bulk delete should succeed even if some jobs are non-terminal",
    );

    let snapshot = engine.queue_state();
    assert!(
        !snapshot.jobs.iter().any(|job| job.id == completed_id),
        "bulk delete should remove eligible terminal jobs",
    );
    assert!(
        snapshot.jobs.iter().any(|job| job.id == queued_id),
        "bulk delete should ignore non-terminal jobs",
    );
}

#[test]
fn bulk_delete_batch_compress_batches_deletes_children_and_metadata_and_notifies_once() {
    let engine = make_engine_with_preset();

    let batch_id = "batch-compress-bulk-delete".to_string();
    let job1_id = "batch-compress-bulk-child-1".to_string();
    let job2_id = "batch-compress-bulk-child-2".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();

        state.batch_compress_batches.insert(
            batch_id.clone(),
            BatchCompressBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                status: BatchCompressBatchStatus::Completed,
                total_files_scanned: 2,
                total_candidates: 2,
                total_processed: 2,
                child_job_ids: vec![job1_id.clone(), job2_id.clone()],
                started_at_ms: 0,
                completed_at_ms: Some(0),
            },
        );

        let base_job = |id: &str, status: JobStatus| TranscodeJob {
            id: id.to_string(),
            filename: format!("C:/videos/{id}.mp4"),
            job_type: JobType::Video,
            source: JobSource::BatchCompress,
            queue_order: None,
            original_size_mb: 10.0,
            original_codec: Some("h264".to_string()),
            preset_id: "preset-1".to_string(),
            status,
            progress: 100.0,
            start_time: Some(current_time_millis()),
            end_time: Some(current_time_millis()),
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: Some(5.0),
            logs: Vec::new(),
            log_head: None,
            skip_reason: None,
            input_path: Some("C:/videos/input.mp4".to_string()),
            created_time_ms: None,
            modified_time_ms: None,
            output_path: Some("C:/videos/input.compressed.mp4".to_string()),
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
            batch_id: Some(batch_id.clone()),
            wait_metadata: None,
        };

        state
            .jobs
            .insert(job1_id.clone(), base_job(&job1_id, JobStatus::Completed));
        state
            .jobs
            .insert(job2_id.clone(), base_job(&job2_id, JobStatus::Skipped));
    }

    let notify_calls = TestArc::new(AtomicUsize::new(0));
    let notify_calls_clone = notify_calls.clone();
    engine.register_queue_lite_listener(move |_| {
        notify_calls_clone.fetch_add(1, Ordering::SeqCst);
    });

    let before = notify_calls.load(Ordering::SeqCst);
    assert!(
        engine.delete_batch_compress_batches_bulk(vec![batch_id.clone()]),
        "delete_batch_compress_batches_bulk must succeed when all children are terminal",
    );
    let after = notify_calls.load(Ordering::SeqCst);
    assert_eq!(
        after,
        before + 1,
        "bulk batch delete must notify queue listeners exactly once",
    );

    let snapshot_after = engine.queue_state();
    assert!(
        !snapshot_after
            .jobs
            .iter()
            .any(|j| j.id == job1_id || j.id == job2_id),
        "bulk batch delete should remove all child jobs from queue state",
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        assert!(
            !state.batch_compress_batches.contains_key(&batch_id),
            "bulk batch delete should remove batch metadata",
        );
    }
}
