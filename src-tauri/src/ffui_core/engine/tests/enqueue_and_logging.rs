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
fn enqueue_transcode_job_plans_output_path_with_filename_immediately() {
    let dir = env::temp_dir();
    let path = dir.join("ffui_test_output_path.mp4");

    {
        let mut file = File::create(&path).expect("create temp video file");
        file.write_all(&[0u8; 1024])
            .expect("write data to temp video file");
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

    let output_path = job
        .output_path
        .as_deref()
        .expect("output_path should be planned at enqueue time");
    let output_buf = PathBuf::from(output_path);

    assert_eq!(
        output_buf.parent(),
        path.parent(),
        "output should default to the input directory"
    );
    let output_file = output_buf
        .file_name()
        .expect("output path should include filename")
        .to_string_lossy();
    assert!(
        output_file.contains("ffui_test_output_path.compressed"),
        "expected output filename to contain suffix: {output_file}"
    );
    assert!(
        output_file.ends_with(".mp4"),
        "expected output filename to end with .mp4: {output_file}"
    );

    let _ = fs::remove_file(&path);
}

#[test]
fn enqueue_transcode_job_snapshots_queue_output_policy() {
    use crate::ffui_core::domain::{OutputContainerPolicy, OutputPolicy};

    let dir = env::temp_dir();
    let path = dir.join("ffui_test_output_policy_snapshot.mp4");

    {
        let mut file = File::create(&path).expect("create temp video file for output policy test");
        file.write_all(&[0u8; 1024])
            .expect("write data to temp video file for output policy test");
    }

    let engine = make_engine_with_preset();

    let policy = OutputPolicy {
        container: OutputContainerPolicy::Force {
            format: "mkv".to_string(),
        },
        ..Default::default()
    };

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.settings.queue_output_policy = policy.clone();
    }

    let job = engine.enqueue_transcode_job(
        path.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    assert_eq!(job.output_policy, Some(policy));

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
    let state_lock = inner.state.lock_unpoisoned();
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

    let state_lock = engine.inner.state.lock_unpoisoned();
    let stored = state_lock
        .jobs
        .get(&job.id)
        .expect("job should be present after logging command");
    let last_log = stored.logs.last().expect("at least one log entry");
    let last_run = stored.runs.last().expect("run history should be present");
    let last_run_log = last_run
        .logs
        .last()
        .expect("run should include the command log line");

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
    assert!(
        last_run_log.contains("\"C:/Videos/input file.mp4\""),
        "run log should quote arguments with spaces"
    );

    drop(state_lock);
    let _ = fs::remove_file(&path);
}

#[test]
fn log_external_command_creates_new_run_for_resume_without_overwriting_initial_command() {
    let dir = env::temp_dir();
    let path = dir.join("ffui_test_log_command_resume.mp4");

    {
        let mut file = File::create(&path).expect("create temp video file for resume log test");
        file.write_all(&[0u8; 1024])
            .expect("write data for resume log test");
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

    let initial_cmd = {
        let state_lock = engine.inner.state.lock_unpoisoned();
        state_lock
            .jobs
            .get(&job.id)
            .and_then(|j| j.ffmpeg_command.clone())
            .unwrap_or_default()
    };

    // Log an initial ffmpeg launch so the job has Run 1.
    let initial_args = vec![
        "-i".to_string(),
        "C:/Videos/input.mp4".to_string(),
        "C:/Videos/output.tmp.mp4".to_string(),
    ];
    log_external_command(&engine.inner, &job.id, "ffmpeg", &initial_args);

    // Simulate a paused/resumable job so the next ffmpeg spawn represents Run 2.
    {
        let mut state_lock = engine.inner.state.lock_unpoisoned();
        let stored = state_lock.jobs.get_mut(&job.id).expect("job present");
        stored.status = JobStatus::Paused;
        stored.progress = 42.0;
        stored.wait_metadata = Some(crate::ffui_core::domain::WaitMetadata {
            last_progress_percent: Some(42.0),
            processed_wall_millis: Some(1234),
            processed_seconds: Some(1.0),
            target_seconds: Some(1.0),
            tmp_output_path: None,
            segments: None,
            segment_end_targets: None,
        });
        if let Some(run) = stored.runs.first_mut() {
            run.started_at_ms = Some(1);
        }
    }

    let args = vec![
        "-ss".to_string(),
        "1".to_string(),
        "-i".to_string(),
        "C:/Videos/input.mp4".to_string(),
        "C:/Videos/output.tmp.mp4".to_string(),
    ];
    log_external_command(&engine.inner, &job.id, "ffmpeg", &args);

    let state_lock = engine.inner.state.lock_unpoisoned();
    let stored = state_lock
        .jobs
        .get(&job.id)
        .expect("job should be present after logging command");

    assert_eq!(
        stored.ffmpeg_command.as_deref().unwrap_or(""),
        initial_cmd.as_str(),
        "initial/full command must remain stable even after resume run logging"
    );
    assert!(
        stored.runs.len() >= 2,
        "resume logging should create a new run entry"
    );
    let first_run = stored.runs.first().expect("first run exists");
    assert!(
        !first_run.command.contains("-ss"),
        "initial run command should not include resume flags"
    );
    let last_run = stored.runs.last().expect("last run exists");
    assert!(
        last_run.command.contains("-ss"),
        "resume run command should include resume flags"
    );
    assert!(
        last_run
            .logs
            .iter()
            .any(|l| l.contains("command:") && l.contains("-ss")),
        "resume run logs should include the executed command line"
    );

    drop(state_lock);
    let _ = fs::remove_file(&path);
}
