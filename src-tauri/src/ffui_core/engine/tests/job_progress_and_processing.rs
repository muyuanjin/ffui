use super::*;
use crate::ffui_core::QueueStateLiteDelta;
#[test]
fn update_job_progress_clamps_and_is_monotonic() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-progress-monotonic".to_string();

    {
        let mut state = inner.state.lock_unpoisoned();
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
                created_time_ms: None,
                modified_time_ms: None,
                output_path: None,
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
            },
        );
    }

    // Negative percentages clamp to 0 and do not move progress.
    update_job_progress(&inner, &job_id, Some(-10.0), None, None, None, None);

    {
        let state = inner.state.lock_unpoisoned();
        let job = state
            .jobs
            .get(&job_id)
            .expect("job must be present after first update");
        assert_eq!(job.progress, 0.0);
    }

    // Normal in-range percentage moves progress forward.
    update_job_progress(&inner, &job_id, Some(42.5), None, None, None, None);

    {
        let state = inner.state.lock_unpoisoned();
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
    update_job_progress(&inner, &job_id, Some(150.0), None, None, None, None);

    {
        let state = inner.state.lock_unpoisoned();
        let job = state
            .jobs
            .get(&job_id)
            .expect("job must be present after third update");
        assert_eq!(job.progress, 100.0);
    }

    // Regressing percentages are ignored to keep progress monotonic.
    update_job_progress(&inner, &job_id, Some(80.0), None, None, None, None);

    {
        let state = inner.state.lock_unpoisoned();
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
fn update_job_progress_emits_queue_lite_delta_for_log_only_updates() {
    let dir = env::temp_dir();
    let path = dir.join("ffui_test_log_stream.mp4");

    {
        let mut file = File::create(&path).expect("create temp video file for log-stream test");
        let data = vec![0u8; 1024 * 1024];
        file.write_all(&data)
            .expect("write data to temp video file for log-stream test");
    }

    let engine = make_engine_with_preset();

    let deltas: TestArc<TestMutex<Vec<QueueStateLiteDelta>>> =
        TestArc::new(TestMutex::new(Vec::new()));
    let deltas_clone = TestArc::clone(&deltas);

    engine.register_queue_lite_delta_listener(move |delta: QueueStateLiteDelta| {
        deltas_clone.lock_unpoisoned().push(delta);
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
        let mut states = deltas.lock_unpoisoned();
        states.clear();
    }

    // Simulate the worker having moved the job into Processing state, as
    // spawn_worker would normally do before calling process_transcode_job.
    {
        let inner = &engine.inner;
        let mut state = inner.state.lock_unpoisoned();
        let stored = state
            .jobs
            .get_mut(&job.id)
            .expect("job should be present in engine state");
        stored.status = JobStatus::Processing;
    }

    // Invoke update_job_progress with only a log line and no percentage.
    // Log lines are still captured for crash recovery / job detail, but they
    // are no longer streamed over queue-lite delta events (to avoid large IPC
    // payloads and UI jank).
    update_job_progress(
        &engine.inner,
        &job.id,
        None,
        None,
        None,
        Some("ffmpeg test progress line"),
        None,
    );

    let states = deltas.lock_unpoisoned();
    assert!(
        states.is_empty(),
        "log-only updates must not emit queue-lite deltas (logs are fetched on-demand)"
    );

    let state = engine.inner.state.lock_unpoisoned();
    let stored = state
        .jobs
        .get(&job.id)
        .expect("job should still be present in engine state");
    let tail = stored.log_tail.as_deref().unwrap_or("");
    assert!(tail.contains("ffmpeg test progress line"));

    let _ = fs::remove_file(&path);
}

#[test]
fn update_job_progress_heals_paused_jobs_when_progress_samples_arrive() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/heal-paused.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    let deltas: TestArc<TestMutex<Vec<QueueStateLiteDelta>>> =
        TestArc::new(TestMutex::new(Vec::new()));
    let deltas_clone = TestArc::clone(&deltas);
    engine.register_queue_lite_delta_listener(move |delta: QueueStateLiteDelta| {
        deltas_clone.lock_unpoisoned().push(delta);
    });

    {
        deltas.lock_unpoisoned().clear();
    }

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let stored_filename = {
            let stored = state
                .jobs
                .get_mut(&job.id)
                .expect("job should exist after enqueue");
            stored.status = JobStatus::Paused;
            stored.progress = 0.0;
            stored.filename.clone()
        };

        // Simulate a restored paused job that is still present in the waiting queue.
        if !state.queue.iter().any(|id| id == &job.id) {
            state.queue.push_back(job.id.clone());
        }
        state.active_jobs.remove(&job.id);
        state.active_inputs.remove(&stored_filename);
    }

    // A real progress sample can only come from an active ffmpeg process.
    // If the job is still marked Paused, the engine must self-heal to Processing
    // so the UI never shows "paused" while progress advances.
    update_job_progress(
        &engine.inner,
        &job.id,
        Some(10.0),
        Some(1.0),
        None,
        None,
        Some(1.0),
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        let stored = state
            .jobs
            .get(&job.id)
            .expect("job should still exist after progress update");
        assert_eq!(
            stored.status,
            JobStatus::Processing,
            "progress samples must promote restored Paused jobs into Processing"
        );
        assert!(
            !state.queue.contains(&job.id),
            "processing jobs must not remain in the waiting queue"
        );
        assert!(
            state.active_jobs.contains(&job.id),
            "processing jobs must be tracked as active"
        );
    }

    let states = deltas.lock_unpoisoned();
    assert!(
        !states.is_empty(),
        "expected a queue-lite delta to be emitted for progress updates"
    );
    let patch = states
        .iter()
        .flat_map(|delta| delta.patches.iter())
        .find(|patch| patch.id == job.id)
        .expect("expected a delta patch for the job");
    assert_eq!(
        patch.status,
        Some(JobStatus::Processing),
        "delta patches must carry the healed Processing status"
    );
}

#[test]
fn update_job_progress_filters_ffmpeg_progress_noise_from_logs() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-progress-noise-filter".to_string();

    {
        let mut state = inner.state.lock_unpoisoned();
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: "C:/videos/noise.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::Manual,
                queue_order: None,
                original_size_mb: 1.0,
                original_codec: None,
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
                created_time_ms: None,
                modified_time_ms: None,
                output_path: None,
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
            },
        );
    }

    update_job_progress(
        &inner,
        &job_id,
        None,
        None,
        None,
        Some("out_time=00:00:01.000000 speed=1.00x progress=continue"),
        None,
    );
    update_job_progress(
        &inner,
        &job_id,
        None,
        None,
        None,
        Some("frame=  123 fps=60 time=00:00:02.00 speed=1.0x"),
        None,
    );
    update_job_progress(
        &inner,
        &job_id,
        None,
        None,
        None,
        Some("Error: encoder failed to initialize"),
        None,
    );

    let state = inner.state.lock_unpoisoned();
    let job = state.jobs.get(&job_id).expect("job present");
    let joined = job
        .logs
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    assert!(
        !joined.contains("out_time=") && !joined.contains("frame="),
        "ffmpeg progress/stats noise should not be appended to logs"
    );
    assert!(
        joined.contains("Error: encoder failed to initialize"),
        "critical error lines must remain present"
    );
}

#[test]
fn worker_selection_does_not_preserve_stale_progress_without_resumable_metadata() {
    let engine = make_engine_with_preset();
    let job_id = "job-stale-progress".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.queue.push_back(job_id.clone());
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: "C:/videos/stale_progress.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::Manual,
                queue_order: None,
                original_size_mb: 100.0,
                original_codec: Some("h264".to_string()),
                preset_id: "preset-1".to_string(),
                status: JobStatus::Queued,
                progress: 42.0,
                start_time: None,
                end_time: None,
                processing_started_ms: None,
                elapsed_ms: Some(1234),
                output_size_mb: None,
                logs: Vec::new(),
                log_head: None,
                skip_reason: None,
                input_path: None,
                created_time_ms: None,
                modified_time_ms: None,
                output_path: None,
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
            },
        );
    }

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let picked = next_job_for_worker_locked(&mut state).expect("job must be selectable");
        assert_eq!(picked, job_id, "expected the queued job to be picked");
        let job = state.jobs.get(&job_id).expect("job must exist");
        assert_eq!(job.status, JobStatus::Processing);
        assert_eq!(
            job.progress, 0.0,
            "stale persisted progress must not suppress early progress updates for a fresh run"
        );
        assert!(
            job.wait_metadata
                .as_ref()
                .and_then(|m| m.last_progress_percent)
                .is_some_and(|p| (p - 42.0).abs() < 0.000_001),
            "expected last_progress_percent to retain resume evidence"
        );
    }
}

#[test]
fn worker_selection_bumps_progress_epoch_and_applies_resume_baseline() {
    let engine = make_engine_with_preset();
    let job_id = "job-resume-baseline".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.queue.push_back(job_id.clone());
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: "C:/videos/in.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::Manual,
                queue_order: None,
                original_size_mb: 100.0,
                original_codec: Some("h264".to_string()),
                preset_id: "preset-1".to_string(),
                status: JobStatus::Queued,
                progress: 50.0,
                start_time: None,
                end_time: None,
                processing_started_ms: None,
                elapsed_ms: None,
                output_size_mb: None,
                logs: Vec::new(),
                log_head: None,
                skip_reason: None,
                input_path: None,
                created_time_ms: None,
                modified_time_ms: None,
                output_path: None,
                output_policy: None,
                ffmpeg_command: None,
                runs: Vec::new(),
                media_info: Some(MediaInfo {
                    duration_seconds: Some(100.0),
                    width: None,
                    height: None,
                    frame_rate: None,
                    video_codec: None,
                    audio_codec: None,
                    size_mb: None,
                }),
                estimated_seconds: None,
                preview_path: None,
                preview_revision: 0,
                log_tail: None,
                failure_reason: None,
                warnings: Vec::new(),
                batch_id: None,
                wait_metadata: Some(WaitMetadata {
                    last_progress_percent: Some(50.0),
                    processed_wall_millis: None,
                    processed_seconds: Some(50.0),
                    target_seconds: Some(40.0),
                    progress_epoch: Some(1),
                    last_progress_out_time_seconds: Some(50.0),
                    last_progress_speed: Some(2.0),
                    last_progress_updated_at_ms: Some(123),
                    last_progress_frame: None,
                    tmp_output_path: None,
                    segments: None,
                    segment_end_targets: None,
                }),
            },
        );
    }

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let picked = next_job_for_worker_locked(&mut state).expect("job must be selectable");
        assert_eq!(picked, job_id);
        let job = state.jobs.get(&job_id).expect("job must exist");
        assert_eq!(job.status, JobStatus::Processing);
        assert!(
            (job.progress - 40.0).abs() < 0.05,
            "expected selection to apply a conservative resume baseline, got {}",
            job.progress
        );
        let meta = job
            .wait_metadata
            .as_ref()
            .expect("wait_metadata must exist");
        assert_eq!(meta.progress_epoch, Some(2));
        assert_eq!(meta.last_progress_out_time_seconds, Some(40.0));
        assert_eq!(meta.last_progress_speed, None);
        assert!(
            meta.last_progress_updated_at_ms.is_some(),
            "expected updated_at to be refreshed for the new epoch"
        );
    }
}

#[test]
fn worker_crash_recovery_probe_clears_stale_resume_paths_when_missing_on_disk() {
    use crate::ffui_core::engine::state::restore_segment_probe::SegmentDirCache;
    use tempfile::tempdir;

    let engine = make_engine_with_preset();
    let job_id = "job-stale-wait-metadata".to_string();
    let dir = tempdir().expect("tempdir");
    let input = dir.path().join("input.mp4");
    let stale_seg0 = dir.path().join("seg0.tmp.mkv");

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: input.to_string_lossy().into_owned(),
                job_type: JobType::Video,
                source: JobSource::Manual,
                queue_order: None,
                original_size_mb: 100.0,
                original_codec: Some("h264".to_string()),
                preset_id: "preset-1".to_string(),
                status: JobStatus::Processing,
                progress: 55.0,
                start_time: Some(0),
                end_time: None,
                processing_started_ms: Some(0),
                elapsed_ms: Some(1234),
                output_size_mb: None,
                logs: Vec::new(),
                log_head: None,
                skip_reason: None,
                input_path: None,
                created_time_ms: None,
                modified_time_ms: None,
                output_path: None,
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
                wait_metadata: Some(WaitMetadata {
                    last_progress_percent: Some(55.0),
                    processed_wall_millis: Some(1234),
                    processed_seconds: Some(10.0),
                    target_seconds: Some(10.0),
                    progress_epoch: None,
                    last_progress_out_time_seconds: Some(10.0),
                    last_progress_speed: None,
                    last_progress_updated_at_ms: None,
                    last_progress_frame: Some(42),
                    tmp_output_path: Some(stale_seg0.to_string_lossy().into_owned()),
                    segments: Some(vec![stale_seg0.to_string_lossy().into_owned()]),
                    segment_end_targets: Some(vec![10.0]),
                }),
            },
        );
    }

    let mut cache = SegmentDirCache::default();
    let changed = probe_crash_recovery_wait_metadata_for_processing_job_best_effort(
        &engine.inner,
        &job_id,
        &mut cache,
    );
    assert!(
        changed,
        "expected stale wait metadata to be sanitized for a fresh run"
    );

    let state = engine.inner.state.lock_unpoisoned();
    let job = state.jobs.get(&job_id).expect("job");
    assert!(
        (job.progress - 0.0).abs() < 0.000_001,
        "stale progress must be reset so early ffmpeg progress updates are not suppressed"
    );
    let meta = job
        .wait_metadata
        .as_ref()
        .expect("wait metadata should remain present");
    assert!(meta.segments.is_none());
    assert!(meta.tmp_output_path.is_none());
    assert!(meta.segment_end_targets.is_none());
    assert!(meta.last_progress_percent.is_none());
    assert!(
        meta.processed_wall_millis.is_some(),
        "elapsed evidence should remain available"
    );
}

#[test]
fn update_job_progress_ignores_whitespace_only_log_lines() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-whitespace-logs".to_string();

    {
        let mut state = inner.state.lock_unpoisoned();
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
                created_time_ms: None,
                modified_time_ms: None,
                output_path: None,
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
            },
        );
    }

    // First append a meaningful log line.
    update_job_progress(
        &inner,
        &job_id,
        None,
        None,
        None,
        Some("ffmpeg test progress line"),
        None,
    );

    // Then feed in whitespace-only lines that should be ignored.
    update_job_progress(&inner, &job_id, None, None, None, Some("   "), None);
    update_job_progress(&inner, &job_id, None, None, None, Some("\t\t"), None);
    update_job_progress(&inner, &job_id, None, None, None, Some(""), None);

    let state = inner.state.lock_unpoisoned();
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
        job.logs[0].text.contains("ffmpeg test progress line"),
        "the original non-empty log line must be preserved",
    );

    let tail = job.log_tail.as_deref().unwrap_or("");
    assert!(
        tail.contains("ffmpeg test progress line"),
        "log_tail should still reflect the meaningful log content",
    );
}

#[test]
fn update_job_progress_delta_carries_base_snapshot_revision_without_bumping() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-delta-base-revision".to_string();

    {
        let mut state = inner.state.lock_unpoisoned();
        state.queue_snapshot_revision = 10;
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
                created_time_ms: None,
                modified_time_ms: None,
                output_path: None,
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
            },
        );
    }

    let deltas: TestArc<TestMutex<Vec<QueueStateLiteDelta>>> =
        TestArc::new(TestMutex::new(Vec::new()));
    let deltas_clone = TestArc::clone(&deltas);
    {
        let mut listeners = inner.queue_lite_delta_listeners.lock_unpoisoned();
        listeners.push(Arc::new(move |delta: QueueStateLiteDelta| {
            deltas_clone.lock_unpoisoned().push(delta);
        }));
    }

    update_job_progress(&inner, &job_id, Some(12.5), None, None, None, None);

    let state = inner.state.lock_unpoisoned();
    assert_eq!(state.queue_snapshot_revision, 10);
    drop(state);

    let deltas = deltas.lock_unpoisoned();
    assert!(!deltas.is_empty());
    let delta = &deltas[deltas.len() - 1];
    assert_eq!(delta.base_snapshot_revision, 10);
    assert_eq!(delta.delta_revision, 1);
    let patch = delta
        .patches
        .iter()
        .find(|p| p.id == job_id)
        .expect("expected delta patch for updated job");
    assert_eq!(patch.status, Some(JobStatus::Processing));
    assert!(patch.progress.is_some());

    let json = serde_json::to_value(delta).expect("delta should serialize");
    let patches = json
        .get("patches")
        .and_then(|v| v.as_array())
        .expect("delta patches should serialize as an array");
    let patch_json = patches
        .iter()
        .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(job_id.as_str()))
        .expect("delta patch should include the job id");
    assert_eq!(
        patch_json.get("status").and_then(|v| v.as_str()),
        Some("processing")
    );
}

#[test]
fn update_job_progress_delta_omits_large_fields_for_ipc() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-delta-omit-large".to_string();

    {
        let mut state = inner.state.lock_unpoisoned();
        state.queue_snapshot_revision = 3;
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
                created_time_ms: None,
                modified_time_ms: None,
                output_path: None,
                output_policy: None,
                ffmpeg_command: None,
                runs: Vec::new(),
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                preview_revision: 0,
                log_tail: Some(
                    "x".repeat(crate::ffui_core::engine::worker_utils::MAX_LOG_TAIL_BYTES),
                ),
                failure_reason: None,
                warnings: Vec::new(),
                batch_id: None,
                wait_metadata: Some(WaitMetadata {
                    last_progress_percent: Some(0.0),
                    processed_wall_millis: Some(123),
                    processed_seconds: Some(1.0),
                    target_seconds: Some(1.0),
                    progress_epoch: None,
                    last_progress_out_time_seconds: Some(1.0),
                    last_progress_speed: None,
                    last_progress_updated_at_ms: None,
                    last_progress_frame: Some(1),
                    tmp_output_path: Some("C:/tmp/seg0.mkv".to_string()),
                    segments: Some(vec!["C:/tmp/seg0.mkv".to_string()]),
                    segment_end_targets: Some(vec![1.0]),
                }),
            },
        );
    }

    let deltas: TestArc<TestMutex<Vec<QueueStateLiteDelta>>> =
        TestArc::new(TestMutex::new(Vec::new()));
    let deltas_clone = TestArc::clone(&deltas);
    {
        let mut listeners = inner.queue_lite_delta_listeners.lock_unpoisoned();
        listeners.push(Arc::new(move |delta: QueueStateLiteDelta| {
            deltas_clone.lock_unpoisoned().push(delta);
        }));
    }

    update_job_progress(&inner, &job_id, Some(1.0), None, None, None, None);

    let deltas = deltas.lock_unpoisoned();
    assert!(!deltas.is_empty());
    let delta = &deltas[deltas.len() - 1];
    assert_eq!(delta.base_snapshot_revision, 3);

    let patch = delta
        .patches
        .iter()
        .find(|p| p.id == job_id)
        .expect("expected delta patch for updated job");
    assert_eq!(patch.status, Some(JobStatus::Processing));
    assert!(patch.progress.is_some());
    assert!(patch.elapsed_ms.is_some());
    assert!(
        patch.preview_path.is_none() && patch.preview_revision.is_none(),
        "queue-lite delta must omit unrelated fields"
    );
}

#[test]
fn process_transcode_job_marks_failure_when_preset_missing() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-missing-preset".to_string();

    {
        let mut state = inner.state.lock_unpoisoned();
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
                created_time_ms: None,
                modified_time_ms: None,
                output_path: None,
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
            },
        );
    }

    let result = process_transcode_job(&inner, &job_id);
    assert!(
        result.is_ok(),
        "processing a job with a missing preset should not bubble an error"
    );

    let state = inner.state.lock_unpoisoned();
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
        job.logs.iter().any(|line| line
            .text
            .contains("No preset found for preset id 'non-existent-preset'")),
        "logs should contain the missing preset message"
    );
}

#[test]
fn update_job_progress_preserves_critical_lines_when_trimming_logs() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-log-trim".to_string();

    {
        let mut state = inner.state.lock_unpoisoned();
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
                created_time_ms: None,
                modified_time_ms: None,
                output_path: None,
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
            },
        );
    }

    let command_line = "command: ffmpeg -i input -c:v libx264 output";
    let error_line = "Error: encoder failed to initialize";

    update_job_progress(&inner, &job_id, None, None, None, Some(command_line), None);
    update_job_progress(&inner, &job_id, None, None, None, Some(error_line), None);

    // Append enough noise lines to trigger trimming past the MAX_LOG_LINES bound.
    for i in 0..520 {
        let line = format!("noise-line-{i}");
        update_job_progress(&inner, &job_id, None, None, None, Some(&line), None);
    }

    let state = inner.state.lock_unpoisoned();
    let job = state
        .jobs
        .get(&job_id)
        .expect("job must be present after log trimming");

    assert!(
        job.logs.len() <= 500,
        "log vector must stay within the bounded window"
    );

    let joined = job
        .logs
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
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
            .is_some_and(|l| l.text.contains("noise-line-519")),
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
