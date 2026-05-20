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

#[test]
fn wait_and_restart_reject_processing_media_batch_child_owned_by_worker() {
    let engine = make_engine_with_preset();
    let batch_id = "batch-processing-media-no-pause".to_string();
    let job_id = "job-processing-media-no-pause".to_string();

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
        job.status = JobStatus::Processing;
        state.jobs.insert(job_id.clone(), job);
        state
            .active_batch_compress_media_jobs
            .insert(job_id.clone());
    }

    assert!(
        !engine.wait_job(&job_id),
        "processing Batch Compress image/audio children should not accept wait"
    );
    assert!(
        !engine.restart_job(&job_id),
        "processing Batch Compress image/audio children should not accept restart"
    );

    let state = engine.inner.state.lock_unpoisoned();
    let job = state.jobs.get(&job_id).expect("job should remain");
    assert_eq!(job.status, JobStatus::Processing);
    assert!(!state.wait_requests.contains(&job_id));
    assert!(!state.restart_requests.contains(&job_id));
    assert!(!state.cancelled_jobs.contains(&job_id));
}

#[test]
fn completed_media_worker_result_wins_over_late_cancel_flag() {
    let engine = make_engine_with_preset();
    let batch_id = "batch-late-cancel-after-media-finalize".to_string();
    let job_id = "job-late-cancel-after-media-finalize".to_string();
    let output_path = "C:/videos/queued-child.webp".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let mut existing = make_batch_child(&job_id, &batch_id);
        existing.job_type = JobType::Image;
        existing.status = JobStatus::Processing;
        state.jobs.insert(job_id.clone(), existing);
        state.cancelled_jobs.insert(job_id.clone());
    }

    let mut completed = make_batch_child(&job_id, &batch_id);
    completed.job_type = JobType::Image;
    completed.status = JobStatus::Completed;
    completed.progress = 100.0;
    completed.end_time = Some(current_time_millis());
    completed.output_path = Some(output_path.clone());
    completed.output_size_mb = Some(1.0);

    store_media_worker_result(&engine.inner, &job_id, completed);

    let state = engine.inner.state.lock_unpoisoned();
    let job = state
        .jobs
        .get(&job_id)
        .expect("completed job should remain");
    assert_eq!(
        job.status,
        JobStatus::Completed,
        "completed media output must not be overwritten by a late cancel flag"
    );
    assert_eq!(job.progress, 100.0);
    assert_eq!(job.output_path.as_deref(), Some(output_path.as_str()));
    assert!(
        !state.cancelled_jobs.contains(&job_id),
        "late cancel flag should be consumed after storing the completed media result"
    );
}

#[test]
fn cancelling_processing_image_batch_child_kills_worker_and_keeps_cancelled_state() {
    let _env_lock = lock_mock_ffmpeg_env();
    let _env_guard = crate::test_support::EnvVarGuard::capture([
        "FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT",
        "FFUI_MOCK_FFMPEG_SILENT_WAIT_FOR_Q_TIMEOUT_MS",
        "FFUI_MOCK_FFMPEG_EXIT_CODE",
    ]);
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT", "1");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_SILENT_WAIT_FOR_Q_TIMEOUT_MS", "1000");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_EXIT_CODE", "0");

    let data_root = tempfile::tempdir().expect("temp data root");
    let _root_guard =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(data_root.path().into());

    let input = data_root.path().join("cancel-image.png");
    fs::write(&input, vec![1u8; 2048]).expect("write image input");
    let final_output = data_root.path().join("cancel-image.webp");
    let tmp_output = data_root.path().join("cancel-image.tmp.webp");

    let engine = make_engine_with_preset();
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.settings.tools.auto_download = false;
        state.settings.tools.ffmpeg_path =
            Some(locate_mock_ffmpeg_exe().to_string_lossy().into_owned());
    }

    let descriptor = engine
        .run_auto_compress(
            data_root.path().to_string_lossy().into_owned(),
            BatchCompressConfig {
                min_image_size_kb: 0,
                image_target_format: ImageTargetFormat::Webp,
                video_preset_id: "preset-1".to_string(),
                ..Default::default()
            },
        )
        .expect("Batch Compress should start");

    let mut attempts = 0;
    let job_id = loop {
        let maybe_job_id = {
            let state = engine.inner.state.lock_unpoisoned();
            state.jobs.iter().find_map(|(id, job)| {
                (job.batch_id.as_deref() == Some(descriptor.batch_id.as_str())
                    && job.job_type == JobType::Image
                    && job.status == JobStatus::Processing)
                    .then(|| id.clone())
            })
        };
        if let Some(job_id) = maybe_job_id {
            break job_id;
        }
        attempts += 1;
        assert!(
            attempts <= 100,
            "image child did not enter processing within timeout"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    };

    assert!(
        engine.cancel_job(&job_id),
        "processing image child should accept cancellation"
    );

    let mut attempts = 0;
    loop {
        let done = {
            let state = engine.inner.state.lock_unpoisoned();
            let job = state.jobs.get(&job_id).expect("job should remain");
            let batch = state
                .batch_compress_batches
                .get(&descriptor.batch_id)
                .expect("batch should remain");
            job.status == JobStatus::Cancelled && batch.total_processed == 1
        };
        if done {
            break;
        }
        attempts += 1;
        assert!(
            attempts <= 150,
            "cancelled image child did not settle within timeout"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    let state = engine.inner.state.lock_unpoisoned();
    let job = state.jobs.get(&job_id).expect("job should remain");
    assert_eq!(job.status, JobStatus::Cancelled);
    let batch = state
        .batch_compress_batches
        .get(&descriptor.batch_id)
        .expect("batch should remain");
    assert_eq!(batch.total_processed, 1);
    assert_eq!(
        batch.processed_child_job_ids.len(),
        1,
        "cancelled processing child must be counted only once"
    );
    assert!(
        !state.cancelled_jobs.contains(&job_id),
        "media worker should consume the cancellation flag"
    );
    drop(state);

    assert!(
        !tmp_output.exists(),
        "cancelled image temp output should be removed"
    );
    assert!(
        !final_output.exists(),
        "cancelled image should not publish a final output"
    );
}
