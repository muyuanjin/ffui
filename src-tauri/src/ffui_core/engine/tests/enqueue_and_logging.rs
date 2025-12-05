use super::*;
#[test]
fn enqueue_transcode_job_uses_actual_file_size_and_waiting_status() {
    let dir = env::temp_dir();
    let path = dir.join("ffui_test_video.mp4");

    // Create a ~5 MB file to have a deterministic, non-zero size.
    {
        let mut file = File::create(&path).expect("create temp video file");
        let data = vec![0u8; 5 * 1024 * 1024];
        file.write_all(&data)
            .expect("write data to temp video file");
    }

    let engine = make_engine_with_preset();
    let job = engine.enqueue_transcode_job(
        path.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        0.0,                 // caller-provided size should be ignored
        Some("h264".into()), // optional codec
        "preset-1".into(),
    );

    // original_size_mb should be derived from the real file size and be > 0.
    assert!(job.original_size_mb > 4.5 && job.original_size_mb < 5.5);
    assert_eq!(job.status, JobStatus::Waiting);

    // Queue state should contain the same value.
    let state = engine.queue_state();
    let stored = state
        .jobs
        .into_iter()
        .find(|j| j.id == job.id)
        .expect("job present in queue_state");
    assert!((stored.original_size_mb - job.original_size_mb).abs() < 0.0001);
    assert_eq!(stored.status, JobStatus::Waiting);

    let _ = fs::remove_file(&path);
}

#[test]
fn cancel_job_cancels_waiting_job_and_removes_from_queue() {
    let dir = env::temp_dir();
    let path = dir.join("ffui_test_cancel.mp4");

    {
        let mut file = File::create(&path).expect("create temp video file for cancel test");
        let data = vec![0u8; 1024 * 1024];
        file.write_all(&data)
            .expect("write data to temp video file for cancel test");
    }

    let engine = make_engine_with_preset();
    let job = engine.enqueue_transcode_job(
        path.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    // Cancel while the job is still in Waiting state in the queue.
    let cancelled = engine.cancel_job(&job.id);
    assert!(cancelled, "cancel_job should return true for waiting job");

    // Queue state should now have the job marked as Cancelled with zero progress.
    let state = engine.queue_state();
    let cancelled_job = state
        .jobs
        .into_iter()
        .find(|j| j.id == job.id)
        .expect("cancelled job present in queue_state");
    assert_eq!(cancelled_job.status, JobStatus::Cancelled);
    assert_eq!(cancelled_job.progress, 0.0);

    // Internal engine state should no longer have the job id in the queue,
    // and logs should contain the explanatory message.
    let inner = &engine.inner;
    let state_lock = inner.state.lock().expect("engine state poisoned");
    assert!(
        !state_lock.queue.contains(&job.id),
        "queue should not contain cancelled job id"
    );
    let stored = state_lock
        .jobs
        .get(&job.id)
        .expect("cancelled job should still be stored");
    assert!(
        stored
            .logs
            .iter()
            .any(|log| log.contains("Cancelled before start")),
        "cancelled job should record explanatory log entry"
    );
    drop(state_lock);

    let _ = fs::remove_file(&path);
}

#[test]
fn log_external_command_stores_full_command_in_job_logs() {
    let dir = env::temp_dir();
    let path = dir.join("ffui_test_log_command.mp4");

    {
        let mut file = File::create(&path).expect("create temp video file for log test");
        file.write_all(&[0u8; 1024])
            .expect("write data for log test");
    }

    let engine = make_engine_with_preset();
    let job = engine.enqueue_transcode_job(
        path.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    let args = vec![
        "-i".to_string(),
        "C:/Videos/input file.mp4".to_string(),
        "C:/Videos/output.tmp.mp4".to_string(),
    ];

    log_external_command(&engine.inner, &job.id, "ffmpeg", &args);

    let state_lock = engine.inner.state.lock().expect("engine state poisoned");
    let stored = state_lock
        .jobs
        .get(&job.id)
        .expect("job should be present after logging command");
    let last_log = stored.logs.last().expect("at least one log entry");

    assert!(
        last_log.contains("ffmpeg"),
        "log should mention the program name"
    );
    assert!(
        last_log.contains("\"C:/Videos/input file.mp4\""),
        "log should quote arguments with spaces"
    );
    assert!(
        last_log.contains("C:/Videos/output.tmp.mp4"),
        "log should include the output path"
    );

    drop(state_lock);
    let _ = fs::remove_file(&path);
}
