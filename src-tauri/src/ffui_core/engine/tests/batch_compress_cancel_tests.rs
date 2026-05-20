use super::*;

fn make_batch_child(job_id: &str, batch_id: &str) -> TranscodeJob {
    TranscodeJob {
        id: job_id.to_string(),
        filename: "C:/videos/queued-child.mp4".to_string(),
        job_type: JobType::Video,
        source: JobSource::BatchCompress,
        queue_order: None,
        original_size_mb: 10.0,
        original_codec: Some("h264".to_string()),
        preset_id: "preset-1".to_string(),
        status: JobStatus::Queued,
        progress: 0.0,
        start_time: None,
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        logs: Vec::new(),
        log_head: None,
        skip_reason: None,
        input_path: Some("C:/videos/queued-child.mp4".to_string()),
        created_time_ms: None,
        modified_time_ms: None,
        output_path: Some("C:/videos/queued-child.compressed.mp4".to_string()),
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
        batch_id: Some(batch_id.to_string()),
        batch_compress_saving_condition: None,
        wait_metadata: None,
    }
}

#[test]
fn cancelling_queued_batch_compress_child_advances_batch_once() {
    let engine = make_engine_with_preset();
    let batch_id = "batch-cancel-queued-child".to_string();
    let job_id = "job-cancel-queued-child".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.batch_compress_batches.insert(
            batch_id.clone(),
            BatchCompressBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                saving_condition_type: SavingConditionType::Ratio,
                min_saving_ratio: 0.95,
                min_saving_absolute_mb: 5.0,
                status: BatchCompressBatchStatus::Running,
                total_files_scanned: 1,
                total_candidates: 1,
                total_processed: 0,
                child_job_ids: vec![job_id.clone()],
                processed_child_job_ids: Default::default(),
                started_at_ms: current_time_millis(),
                completed_at_ms: None,
            },
        );
        state
            .jobs
            .insert(job_id.clone(), make_batch_child(&job_id, &batch_id));
        state.queue.push_back(job_id.clone());
    }

    assert!(
        engine.cancel_job(&job_id),
        "cancel_job should accept queued Batch Compress children"
    );

    let summary = engine
        .batch_compress_batch_summary(&batch_id)
        .expect("Batch Compress summary should remain available after child cancel");
    assert_eq!(summary.total_candidates, 1);
    assert_eq!(
        summary.total_processed, 1,
        "cancelling a queued child should count it as processed"
    );

    // A duplicate terminal mark can happen if another path observes the same
    // child after cancellation; the batch counter must remain stable.
    mark_batch_compress_child_processed(&engine.inner, &job_id);
    let summary_after_duplicate = engine
        .batch_compress_batch_summary(&batch_id)
        .expect("Batch Compress summary should remain available after duplicate terminal mark");
    assert_eq!(
        summary_after_duplicate.total_processed, 1,
        "Batch Compress child terminal accounting must be idempotent"
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        let batch = state
            .batch_compress_batches
            .get(&batch_id)
            .expect("batch should still exist");
        assert_eq!(batch.status, BatchCompressBatchStatus::Completed);
        let job = state
            .jobs
            .get(&job_id)
            .expect("cancelled child should remain");
        assert_eq!(job.status, JobStatus::Cancelled);
        assert!(
            !state.queue.iter().any(|id| id == &job_id),
            "cancelled queued child should be removed from the waiting queue"
        );
    }
}

#[test]
fn bulk_cancelling_waiting_batch_compress_children_advances_batch_once() {
    let engine = make_engine_with_preset();
    let batch_id = "batch-bulk-cancel-waiting-children".to_string();
    let queued_video_id = "job-bulk-cancel-queued-video-child".to_string();
    let paused_image_id = "job-bulk-cancel-paused-image-child".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.batch_compress_batches.insert(
            batch_id.clone(),
            BatchCompressBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                saving_condition_type: SavingConditionType::Ratio,
                min_saving_ratio: 0.95,
                min_saving_absolute_mb: 5.0,
                status: BatchCompressBatchStatus::Running,
                total_files_scanned: 2,
                total_candidates: 2,
                total_processed: 0,
                child_job_ids: vec![queued_video_id.clone(), paused_image_id.clone()],
                processed_child_job_ids: Default::default(),
                started_at_ms: current_time_millis(),
                completed_at_ms: None,
            },
        );

        let queued_video = make_batch_child(&queued_video_id, &batch_id);
        let mut paused_image = make_batch_child(&paused_image_id, &batch_id);
        paused_image.job_type = JobType::Image;
        paused_image.status = JobStatus::Paused;

        state.jobs.insert(queued_video_id.clone(), queued_video);
        state.jobs.insert(paused_image_id.clone(), paused_image);
        state.queue.push_back(queued_video_id.clone());
        state.queue.push_back(paused_image_id.clone());
    }

    assert!(
        engine.cancel_jobs_bulk(vec![queued_video_id.clone(), paused_image_id.clone()]),
        "cancel_jobs_bulk should accept queued/paused Batch Compress children"
    );

    let summary = engine
        .batch_compress_batch_summary(&batch_id)
        .expect("Batch Compress summary should remain available after bulk cancel");
    assert_eq!(summary.total_candidates, 2);
    assert_eq!(
        summary.total_processed, 2,
        "bulk-cancelled waiting children should count as processed"
    );

    let state = engine.inner.state.lock_unpoisoned();
    let batch = state
        .batch_compress_batches
        .get(&batch_id)
        .expect("batch should still exist");
    assert_eq!(batch.status, BatchCompressBatchStatus::Completed);
    assert_eq!(
        batch.processed_child_job_ids.len(),
        2,
        "bulk cancellation accounting must mark each child only once"
    );
    for job_id in [&queued_video_id, &paused_image_id] {
        let job = state
            .jobs
            .get(job_id)
            .expect("cancelled child should remain");
        assert_eq!(job.status, JobStatus::Cancelled);
        assert!(
            !state.queue.iter().any(|id| id == job_id),
            "bulk-cancelled waiting child should be removed from the normal queue"
        );
    }
}

#[test]
fn paused_batch_compress_child_does_not_count_as_processed() {
    let engine = make_engine_with_preset();
    let batch_id = "batch-paused-child".to_string();
    let job_id = "job-paused-child".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.batch_compress_batches.insert(
            batch_id.clone(),
            BatchCompressBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/images".to_string(),
                replace_original: false,
                saving_condition_type: SavingConditionType::Ratio,
                min_saving_ratio: 0.95,
                min_saving_absolute_mb: 5.0,
                status: BatchCompressBatchStatus::Running,
                total_files_scanned: 1,
                total_candidates: 1,
                total_processed: 0,
                child_job_ids: vec![job_id.clone()],
                processed_child_job_ids: Default::default(),
                started_at_ms: current_time_millis(),
                completed_at_ms: None,
            },
        );
        let mut job = make_batch_child(&job_id, &batch_id);
        job.job_type = JobType::Image;
        job.status = JobStatus::Paused;
        state.jobs.insert(job_id.clone(), job);
        state
            .active_batch_compress_media_jobs
            .insert(job_id.clone());
    }

    mark_batch_compress_child_processed(&engine.inner, &job_id);

    let summary = engine
        .batch_compress_batch_summary(&batch_id)
        .expect("Batch Compress summary should remain available after paused child mark");
    assert_eq!(
        summary.total_processed, 0,
        "paused Batch Compress children must not be dropped as processed"
    );

    let state = engine.inner.state.lock_unpoisoned();
    let job = state.jobs.get(&job_id).expect("paused child should remain");
    assert_eq!(job.status, JobStatus::Paused);
    assert!(
        !state.queue.iter().any(|id| id == &job_id),
        "paused image/audio child should remain owned by the media worker"
    );
}

#[test]
fn resuming_paused_media_batch_child_wakes_media_worker_without_normal_queue_handoff() {
    let engine = make_engine_with_preset();
    let batch_id = "batch-paused-media-resume".to_string();
    let job_id = "job-paused-media-resume".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.batch_compress_batches.insert(
            batch_id.clone(),
            BatchCompressBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/images".to_string(),
                replace_original: false,
                saving_condition_type: SavingConditionType::Ratio,
                min_saving_ratio: 0.95,
                min_saving_absolute_mb: 5.0,
                status: BatchCompressBatchStatus::Running,
                total_files_scanned: 1,
                total_candidates: 1,
                total_processed: 0,
                child_job_ids: vec![job_id.clone()],
                processed_child_job_ids: Default::default(),
                started_at_ms: current_time_millis(),
                completed_at_ms: None,
            },
        );
        let mut job = make_batch_child(&job_id, &batch_id);
        job.job_type = JobType::Image;
        job.status = JobStatus::Paused;
        state.jobs.insert(job_id.clone(), job);
        state
            .active_batch_compress_media_jobs
            .insert(job_id.clone());
    }

    assert!(
        engine.resume_job(&job_id),
        "resume_job should accept paused Batch Compress media children"
    );

    let state = engine.inner.state.lock_unpoisoned();
    let job = state
        .jobs
        .get(&job_id)
        .expect("resumed media child should remain");
    assert_eq!(job.status, JobStatus::Queued);
    assert!(
        !state.queue.iter().any(|id| id == &job_id),
        "resumed image/audio Batch Compress children must be left for the media worker, not the normal queue"
    );
}
