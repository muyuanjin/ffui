use super::*;

#[test]
fn notify_queue_listeners_repairs_waiting_queue_invariants() {
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

    let waiting_id = "job-queue-repair-waiting".to_string();
    let queued_id = "job-queue-repair-queued".to_string();
    let paused_id = "job-queue-repair-paused".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            waiting_id.clone(),
            make_job(&waiting_id, JobStatus::Waiting),
        );
        state
            .jobs
            .insert(queued_id.clone(), make_job(&queued_id, JobStatus::Queued));
        state
            .jobs
            .insert(paused_id.clone(), make_job(&paused_id, JobStatus::Paused));

        // Corrupt the queue:
        // - paused job id is allowed but must be unique
        // - duplicates should be removed
        // - missing id should be removed
        // - queued job id is intentionally missing and should be re-added
        state.queue.push_back(paused_id.clone());
        state.queue.push_back(waiting_id.clone());
        state.queue.push_back(waiting_id.clone());
        state
            .queue
            .push_back("job-queue-repair-missing".to_string());
    }

    notify_queue_listeners(&engine.inner);

    let state = engine.inner.state.lock_unpoisoned();
    let queue_ids: Vec<String> = state.queue.iter().cloned().collect();
    assert_eq!(
        queue_ids.iter().filter(|id| *id == &waiting_id).count(),
        1,
        "waiting job id should appear once in queue",
    );
    assert_eq!(
        queue_ids.iter().filter(|id| *id == &queued_id).count(),
        1,
        "queued job id should be re-added to queue",
    );
    assert!(
        queue_ids.contains(&paused_id),
        "paused job id should remain in queue ordering",
    );
    assert!(
        !queue_ids.contains(&"job-queue-repair-missing".to_string()),
        "unknown job ids must be removed from waiting queue",
    );
}
