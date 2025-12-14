use super::*;
#[test]
fn update_job_progress_clamps_and_is_monotonic() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-progress-monotonic".to_string();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: "C:/videos/monotonic.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::Manual,
                queue_order: None,
                original_size_mb: 100.0,
                original_codec: Some("h264".to_string()),
                preset_id: "preset-1".to_string(),
                status: JobStatus::Processing,
                progress: 0.0,
                start_time: Some(0),
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
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                log_tail: None,
                failure_reason: None,
                warnings: Vec::new(),
                batch_id: None,
                wait_metadata: None,
            },
        );
    }

    // Negative percentages clamp to 0 and do not move progress.
    update_job_progress(&inner, &job_id, Some(-10.0), None, None);

    {
        let state = inner.state.lock().expect("engine state poisoned");
        let job = state
            .jobs
            .get(&job_id)
            .expect("job must be present after first update");
        assert_eq!(job.progress, 0.0);
    }

    // Normal in-range percentage moves progress forward.
    update_job_progress(&inner, &job_id, Some(42.5), None, None);

    {
        let state = inner.state.lock().expect("engine state poisoned");
        let job = state
            .jobs
            .get(&job_id)
            .expect("job must be present after second update");
        assert!(
            (job.progress - 42.5).abs() < f64::EPSILON,
            "progress should track the clamped percentage"
        );
    }

    // Values above 100 clamp to 100.
    update_job_progress(&inner, &job_id, Some(150.0), None, None);

    {
        let state = inner.state.lock().expect("engine state poisoned");
        let job = state
            .jobs
            .get(&job_id)
            .expect("job must be present after third update");
        assert_eq!(job.progress, 100.0);
    }

    // Regressing percentages are ignored to keep progress monotonic.
    update_job_progress(&inner, &job_id, Some(80.0), None, None);

    {
        let state = inner.state.lock().expect("engine state poisoned");
        let job = state
            .jobs
            .get(&job_id)
            .expect("job must be present after final update");
        assert_eq!(
            job.progress, 100.0,
            "progress must remain monotonic and never decrease"
        );
    }
}

#[test]
fn update_job_progress_emits_queue_snapshot_for_log_only_updates() {
    let dir = env::temp_dir();
    let path = dir.join("ffui_test_log_stream.mp4");

    {
        let mut file = File::create(&path).expect("create temp video file for log-stream test");
        let data = vec![0u8; 1024 * 1024];
        file.write_all(&data)
            .expect("write data to temp video file for log-stream test");
    }

    let engine = make_engine_with_preset();

    let snapshots: TestArc<TestMutex<Vec<QueueState>>> = TestArc::new(TestMutex::new(Vec::new()));
    let snapshots_clone = TestArc::clone(&snapshots);

    engine.register_queue_listener(move |state: QueueState| {
        snapshots_clone
            .lock()
            .expect("snapshots lock poisoned")
            .push(state);
    });

    let job = engine.enqueue_transcode_job(
        path.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    // Clear any initial snapshots from enqueue so we can focus on the
    // behaviour of update_job_progress itself.
    {
        let mut states = snapshots.lock().expect("snapshots lock poisoned");
        states.clear();
    }

    // Simulate the worker having moved the job into Processing state, as
    // spawn_worker would normally do before calling process_transcode_job.
    {
        let inner = &engine.inner;
        let mut state = inner.state.lock().expect("engine state poisoned");
        let stored = state
            .jobs
            .get_mut(&job.id)
            .expect("job should be present in engine state");
        stored.status = JobStatus::Processing;
    }

    // Invoke update_job_progress with only a log line and no percentage.
    // This previously failed to emit any queue snapshots, causing the UI
    // to see no live logs or ffmpeg command until some later state change
    // such as cancellation or completion.
    update_job_progress(
        &engine.inner,
        &job.id,
        None,
        Some("ffmpeg test progress line"),
        None,
    );

    let states = snapshots.lock().expect("snapshots lock poisoned");
    assert!(
        !states.is_empty(),
        "log-only progress updates for processing jobs must emit at least one queue snapshot"
    );
    let snapshot_job = states
        .iter()
        .flat_map(|s| s.jobs.iter())
        .find(|j| j.id == job.id)
        .expect("snapshot should contain the updated job");
    assert!(
        snapshot_job
            .logs
            .iter()
            .any(|l| l.contains("ffmpeg test progress line")),
        "snapshot logs should include the newly appended log line"
    );

    let _ = fs::remove_file(&path);
}

#[test]
fn update_job_progress_ignores_whitespace_only_log_lines() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-whitespace-logs".to_string();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: "dummy.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::Manual,
                queue_order: None,
                original_size_mb: 100.0,
                original_codec: Some("h264".to_string()),
                preset_id: "preset-1".to_string(),
                status: JobStatus::Processing,
                progress: 0.0,
                start_time: Some(0),
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
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                log_tail: None,
                failure_reason: None,
                warnings: Vec::new(),
                batch_id: None,
                wait_metadata: None,
            },
        );
    }

    // First append a meaningful log line.
    update_job_progress(
        &inner,
        &job_id,
        None,
        Some("ffmpeg test progress line"),
        None,
    );

    // Then feed in whitespace-only lines that should be ignored.
    update_job_progress(&inner, &job_id, None, Some("   "), None);
    update_job_progress(&inner, &job_id, None, Some("\t\t"), None);
    update_job_progress(&inner, &job_id, None, Some(""), None);

    let state = inner.state.lock().expect("engine state poisoned");
    let job = state
        .jobs
        .get(&job_id)
        .expect("job must be present after whitespace log updates");

    assert_eq!(
        job.logs.len(),
        1,
        "whitespace-only log lines should not be stored in job.logs",
    );
    assert!(
        job.logs[0].contains("ffmpeg test progress line"),
        "the original non-empty log line must be preserved",
    );

    let tail = job.log_tail.as_deref().unwrap_or("");
    assert!(
        tail.contains("ffmpeg test progress line"),
        "log_tail should still reflect the meaningful log content",
    );
}

#[test]
fn process_transcode_job_marks_failure_when_preset_missing() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-missing-preset".to_string();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: "C:/videos/sample.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::Manual,
                queue_order: None,
                original_size_mb: 100.0,
                original_codec: Some("h264".to_string()),
                preset_id: "non-existent-preset".to_string(),
                status: JobStatus::Processing,
                progress: 0.0,
                start_time: Some(0),
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
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                log_tail: None,
                failure_reason: None,
                warnings: Vec::new(),
                batch_id: None,
                wait_metadata: None,
            },
        );
    }

    let result = process_transcode_job(&inner, &job_id);
    assert!(
        result.is_ok(),
        "processing a job with a missing preset should not bubble an error"
    );

    let state = inner.state.lock().expect("engine state poisoned");
    let job = state
        .jobs
        .get(&job_id)
        .expect("job must remain present after processing");
    assert_eq!(job.status, JobStatus::Failed);
    assert_eq!(job.progress, 100.0);

    let failure = job.failure_reason.as_ref().expect("failure_reason present");
    assert!(
        failure.contains("No preset found for preset id 'non-existent-preset'"),
        "failure_reason should mention the missing preset id, got: {failure}"
    );
    assert!(
        job.logs
            .iter()
            .any(|line| line.contains("No preset found for preset id 'non-existent-preset'")),
        "logs should contain the missing preset message"
    );
}

#[test]
fn update_job_progress_preserves_critical_lines_when_trimming_logs() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-log-trim".to_string();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: "C:/videos/trim-test.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::Manual,
                queue_order: None,
                original_size_mb: 50.0,
                original_codec: Some("h264".to_string()),
                preset_id: "preset-1".to_string(),
                status: JobStatus::Processing,
                progress: 0.0,
                start_time: Some(0),
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
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                log_tail: None,
                failure_reason: None,
                warnings: Vec::new(),
                batch_id: None,
                wait_metadata: None,
            },
        );
    }

    let command_line = "command: ffmpeg -i input -c:v libx264 output";
    let error_line = "Error: encoder failed to initialize";

    update_job_progress(&inner, &job_id, None, Some(command_line), None);
    update_job_progress(&inner, &job_id, None, Some(error_line), None);

    // Append enough noise lines to trigger trimming past the MAX_LOG_LINES bound.
    for i in 0..520 {
        let line = format!("noise-line-{i}");
        update_job_progress(&inner, &job_id, None, Some(&line), None);
    }

    let state = inner.state.lock().expect("engine state poisoned");
    let job = state
        .jobs
        .get(&job_id)
        .expect("job must be present after log trimming");

    assert!(
        job.logs.len() <= 500,
        "log vector must stay within the bounded window"
    );

    let joined = job.logs.join("\n");
    assert!(
        joined.contains(command_line),
        "command line should be preserved even when trimming",
    );
    assert!(
        joined.contains(error_line),
        "error line should be preserved even when trimming",
    );
    assert!(
        job.logs
            .last()
            .map(|l| l.contains("noise-line-519"))
            .unwrap_or(false),
        "most recent log lines should remain present after trimming",
    );

    let tail = job.log_tail.as_deref().unwrap_or("");
    assert!(
        tail.contains(error_line),
        "log_tail must include critical error lines",
    );
    assert!(
        tail.contains("noise-line-519"),
        "log_tail should reflect the latest output",
    );
}
