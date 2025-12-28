use super::*;

fn make_job(id: &str, status: JobStatus) -> TranscodeJob {
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
        wait_metadata: None,
    }
}

#[test]
fn reorder_waiting_jobs_returns_ok_for_noop_reorder() {
    let data_root = tempfile::tempdir().expect("temp data root");
    let _root_guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_root.path().to_path_buf(),
    );

    let engine = make_engine_with_preset();
    let a = "job-reorder-a".to_string();
    let b = "job-reorder-b".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state
            .jobs
            .insert(a.clone(), make_job(&a, JobStatus::Queued));
        state
            .jobs
            .insert(b.clone(), make_job(&b, JobStatus::Queued));
        state.queue.push_back(a.clone());
        state.queue.push_back(b.clone());
    }

    assert!(
        engine.reorder_waiting_jobs(vec![a.clone(), b.clone()]),
        "noop reorder should still be accepted",
    );

    let state = engine.inner.state.lock_unpoisoned();
    let order: Vec<String> = state.queue.iter().cloned().collect();
    assert_eq!(order, vec![a, b]);
}

#[test]
fn reorder_waiting_jobs_returns_ok_when_queue_empty() {
    let data_root = tempfile::tempdir().expect("temp data root");
    let _root_guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_root.path().to_path_buf(),
    );

    let engine = make_engine_with_preset();
    assert!(
        engine.reorder_waiting_jobs(vec!["job-reorder-missing".to_string()]),
        "reorder should be accepted even if queue is empty",
    );
}
