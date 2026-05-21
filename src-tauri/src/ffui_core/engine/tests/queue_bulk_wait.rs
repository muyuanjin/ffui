use super::*;

#[test]
fn bulk_wait_pauses_queued_jobs_before_worker_slot_is_freed() {
    let data_root = tempfile::tempdir().expect("temp data root");
    let _root_guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_root.path().to_path_buf(),
    );

    let engine = make_engine_with_preset();

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
        batch_compress_saving_condition: None,
        wait_metadata: None,
    };

    let processing_id = "job-bulk-wait-processing".to_string();
    let queued_id = "job-bulk-wait-queued".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            processing_id.clone(),
            make_job(&processing_id, JobStatus::Processing),
        );
        state.active_jobs.insert(processing_id.clone());
        state
            .active_inputs
            .insert(format!("C:/videos/{processing_id}.mp4"));

        state
            .jobs
            .insert(queued_id.clone(), make_job(&queued_id, JobStatus::Queued));
        state.queue.push_back(queued_id.clone());
    }

    assert!(
        engine.wait_jobs_bulk(vec![processing_id.clone(), queued_id.clone()]),
        "bulk wait should accept processing + queued jobs",
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        assert!(
            state.wait_requests.contains(&processing_id),
            "processing job should be marked for cooperative wait",
        );
        let queued = state.jobs.get(&queued_id).expect("queued job exists");
        assert_eq!(
            queued.status,
            JobStatus::Paused,
            "queued job should be paused immediately so it cannot be selected",
        );
    }

    // Simulate the worker releasing its slot after the processing job reaches a
    // safe pause point. The queued job must not start because it is already paused.
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.active_jobs.remove(&processing_id);
        state
            .active_inputs
            .remove(&format!("C:/videos/{processing_id}.mp4"));
        let next = next_job_for_worker_locked(&mut state);
        assert!(
            next.is_none(),
            "paused queued job must not be started while bulk pause is in progress",
        );
    }
}

#[test]
fn bulk_wait_ignores_terminal_jobs_instead_of_failing() {
    let data_root = tempfile::tempdir().expect("temp data root");
    let _root_guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_root.path().to_path_buf(),
    );

    let engine = make_engine_with_preset();

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
        batch_compress_saving_condition: None,
        wait_metadata: None,
    };

    let processing_id = "job-bulk-wait-ignores-terminal-processing".to_string();
    let completed_id = "job-bulk-wait-ignores-terminal-completed".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            processing_id.clone(),
            make_job(&processing_id, JobStatus::Processing),
        );
        state.active_jobs.insert(processing_id.clone());
        state
            .active_inputs
            .insert(format!("C:/videos/{processing_id}.mp4"));

        state.jobs.insert(
            completed_id.clone(),
            make_job(&completed_id, JobStatus::Completed),
        );
    }

    assert!(
        engine.wait_jobs_bulk(vec![processing_id.clone(), completed_id.clone()]),
        "bulk wait should succeed even if some jobs are already terminal",
    );

    let state = engine.inner.state.lock_unpoisoned();
    assert!(
        state.wait_requests.contains(&processing_id),
        "processing job should be marked for cooperative wait",
    );
    let completed = state.jobs.get(&completed_id).expect("job exists");
    assert_eq!(
        completed.status,
        JobStatus::Completed,
        "terminal jobs should be ignored, not rejected",
    );
}

#[test]
fn bulk_wait_requests_active_media_child_and_pauses_other_selected_jobs() {
    let engine = make_engine_with_preset();

    let media_child_id = "job-bulk-wait-active-media-child".to_string();
    let queued_id = "job-bulk-wait-active-media-queued".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();

        let mut media_child = TranscodeJob {
            id: media_child_id.clone(),
            filename: format!("C:/images/{media_child_id}.png"),
            job_type: JobType::Image,
            source: JobSource::BatchCompress,
            queue_order: None,
            original_size_mb: 1.0,
            original_codec: Some("png".to_string()),
            preset_id: "preset-1".to_string(),
            status: JobStatus::Processing,
            progress: 0.0,
            start_time: Some(current_time_millis()),
            end_time: None,
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: None,
            logs: Vec::new(),
            log_head: None,
            skip_reason: None,
            input_path: Some(format!("C:/images/{media_child_id}.png")),
            created_time_ms: None,
            modified_time_ms: None,
            output_path: Some(format!("C:/images/{media_child_id}.webp")),
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
            batch_id: Some("batch-bulk-wait-active-media".to_string()),
            batch_compress_saving_condition: None,
            wait_metadata: None,
        };
        media_child.progress = 42.0;

        let mut queued = media_child.clone();
        queued.id = queued_id.clone();
        queued.filename = format!("C:/videos/{queued_id}.mp4");
        queued.job_type = JobType::Video;
        queued.source = JobSource::Manual;
        queued.status = JobStatus::Queued;
        queued.progress = 0.0;
        queued.input_path = Some(format!("C:/videos/{queued_id}.mp4"));
        queued.output_path = Some(format!("C:/videos/{queued_id}.compressed.mp4"));
        queued.batch_id = None;

        state.jobs.insert(media_child_id.clone(), media_child);
        state.jobs.insert(queued_id.clone(), queued);
        state.queue.push_back(queued_id.clone());
        state
            .active_batch_compress_media_jobs
            .insert(media_child_id.clone());
    }

    assert!(
        engine.wait_jobs_bulk(vec![media_child_id.clone(), queued_id.clone()]),
        "bulk wait should request wait for active Batch Compress media children and pause other jobs",
    );

    let state = engine.inner.state.lock_unpoisoned();
    assert!(
        state.wait_requests.contains(&media_child_id),
        "bulk wait must record a wait request for the active media child",
    );
    assert!(
        !state.wait_requests.contains(&queued_id),
        "queued jobs are paused immediately instead of using cooperative wait requests",
    );
    assert_eq!(
        state
            .jobs
            .get(&queued_id)
            .expect("queued job exists")
            .status,
        JobStatus::Paused,
        "bulk wait must still pause other selected queued jobs",
    );
    let media_child = state.jobs.get(&media_child_id).expect("media child exists");
    assert_eq!(media_child.status, JobStatus::Processing);
    assert_eq!(media_child.progress, 42.0);
}
