use super::*;
use crate::ffui_core::engine::job_runner::current_time_millis;
#[test]
fn inspect_media_produces_json_for_generated_clip() {
    if !ffmpeg_available() {
        eprintln!("Skipping inspect_media test: ffmpeg is not available on PATH");
        return;
    }

    let dir = env::temp_dir().join("ffui_inspect_media_test");
    let _ = fs::create_dir_all(&dir);
    let input = dir.join("inspect_media_sample.mp4");

    if !generate_test_input_video(&input) {
        eprintln!(
            "Skipping inspect_media test: failed to generate synthetic test video at {}",
            input.display()
        );
        let _ = fs::remove_dir_all(&dir);
        return;
    }

    let engine = make_engine_with_preset();
    let input_str = input.to_string_lossy();
    let json = engine
        .inspect_media(&input_str)
        .expect("inspect_media should succeed for generated test clip");

    let root: serde_json::Value =
        serde_json::from_str(&json).expect("inspect_media output should be valid JSON");

    assert!(
        root.get("format").is_some(),
        "ffprobe JSON output should contain a top-level \"format\" object"
    );
    assert!(
        root.get("streams").is_some(),
        "ffprobe JSON output should contain a top-level \"streams\" array"
    );

    let file = root
        .get("file")
        .expect("inspect_media should enrich ffprobe JSON with a top-level \"file\" object");
    assert_eq!(
        file.get("exists").and_then(serde_json::Value::as_bool),
        Some(true),
        "file.exists should be true for the generated test clip"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn multi_worker_selection_respects_fifo_and_processing_limit() {
    let engine = make_engine_with_preset();

    // Enqueue several synthetic jobs to populate the in-memory queue.
    let mut job_ids_in_order = Vec::new();
    for i in 0..6 {
        let job = engine.enqueue_transcode_job(
            format!("C:/videos/input-{i}.mp4"),
            JobType::Video,
            JobSource::Manual,
            100.0,
            Some("h264".into()),
            "preset-1".into(),
        );
        job_ids_in_order.push(job.id.clone());
    }

    let workers = 3usize;
    let mut selected = Vec::new();

    {
        let mut state = engine.inner.state.lock_unpoisoned();

        for _ in 0..workers {
            if let Some(id) = next_job_for_worker_locked(&mut state) {
                selected.push(id);
            }
        }

        // No matter how many jobs are waiting, at most `workers` jobs may
        // be marked Processing at the same time.
        let processing_count = state
            .jobs
            .values()
            .filter(|j| j.status == JobStatus::Processing)
            .count();
        assert!(
            processing_count <= workers,
            "processing job count {processing_count} must not exceed worker slots {workers}"
        );
    }

    // The jobs taken by the simulated workers must correspond to the
    // earliest enqueued jobs in FIFO order.
    let expected: Vec<String> = job_ids_in_order
        .iter()
        .take(selected.len())
        .cloned()
        .collect();
    assert_eq!(
        selected, expected,
        "workers must always take jobs from the front of the queue in FIFO order"
    );
}

#[test]
fn cancelling_processing_job_in_multi_worker_pool_only_affects_target_job() {
    let engine = make_engine_with_preset();

    // Enqueue a few jobs and mark two of them as processing, as if two
    // worker threads had claimed work from the queue.
    let mut job_ids_in_order = Vec::new();
    for i in 0..4 {
        let job = engine.enqueue_transcode_job(
            format!("C:/videos/cancel-{i}.mp4"),
            JobType::Video,
            JobSource::Manual,
            100.0,
            Some("h264".into()),
            "preset-1".into(),
        );
        job_ids_in_order.push(job.id.clone());
    }

    let workers = 2usize;
    let mut processing_ids = Vec::new();
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        for _ in 0..workers {
            if let Some(id) = next_job_for_worker_locked(&mut state) {
                processing_ids.push(id);
            }
        }
    }

    assert_eq!(
        processing_ids.len(),
        workers,
        "expected to simulate {workers} processing jobs"
    );

    let target = processing_ids[0].clone();
    let other = processing_ids[1].clone();

    // Request cancellation of one processing job.
    let cancelled = engine.cancel_job(&target);
    assert!(
        cancelled,
        "cancel_job must succeed for a job in Processing status"
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        assert!(
            state.cancelled_jobs.contains(&target),
            "cancelled_jobs set must contain the target job id"
        );
        assert!(
            !state.cancelled_jobs.contains(&other),
            "cancelled_jobs set must not contain other processing jobs"
        );
    }

    // Simulate the cooperative cancellation path that process_transcode_job
    // would take once it observes the cancelled flag.
    mark_job_cancelled(&engine.inner, &target)
        .expect("mark_job_cancelled must succeed for target job");

    let state = engine.inner.state.lock_unpoisoned();

    let target_job = state
        .jobs
        .get(&target)
        .expect("cancelled job must remain in jobs map");
    assert_eq!(
        target_job.status,
        JobStatus::Cancelled,
        "target job must transition to Cancelled status after cooperative cancellation"
    );

    let other_job = state
        .jobs
        .get(&other)
        .expect("other processing job must remain in jobs map");
    assert_eq!(
        other_job.status,
        JobStatus::Processing,
        "other processing jobs must remain Processing when only one job is cancelled"
    );
}

#[test]
fn multi_worker_wait_resume_respects_queue_order() {
    let engine = make_engine_with_preset();

    // Enqueue three jobs in a known order.
    let mut job_ids = Vec::new();
    for i in 0..3 {
        let job = engine.enqueue_transcode_job(
            format!("C:/videos/multi-wait-{i}.mp4"),
            JobType::Video,
            JobSource::Manual,
            100.0,
            Some("h264".into()),
            "preset-1".into(),
        );
        job_ids.push(job.id.clone());
    }

    // Simulate two workers taking the first two jobs.
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let first = next_job_for_worker_locked(&mut state).expect("first job");
        let second = next_job_for_worker_locked(&mut state).expect("second job");
        assert_eq!(first, job_ids[0]);
        assert_eq!(second, job_ids[1]);

        // Give the first job some progress and media info so wait metadata
        // can derive a processed duration.
        if let Some(job) = state.jobs.get_mut(&job_ids[0]) {
            job.progress = 40.0;
            job.media_info = Some(MediaInfo {
                duration_seconds: Some(100.0),
                width: None,
                height: None,
                frame_rate: None,
                video_codec: None,
                audio_codec: None,
                size_mb: None,
            });
        }
    }

    // Request a wait operation for the first processing job.
    let accepted = engine.wait_job(&job_ids[0]);
    assert!(accepted, "wait_job must accept a Processing job");

    // Apply the wait cooperatively as the worker loop would.
    let tmp = PathBuf::from("C:/videos/multi-worker-wait.compressed.tmp.mp4");
    let out = PathBuf::from("C:/videos/multi-worker-wait.compressed.mp4");
    mark_job_waiting(&engine.inner, &job_ids[0], &tmp, &out, Some(100.0), None)
        .expect("mark_job_waiting must succeed");

    {
        let state = engine.inner.state.lock_unpoisoned();
        assert!(
            state.queue.contains(&job_ids[0]),
            "paused job should remain visible in queue ordering"
        );
    }

    // Resume the paused job; it should keep its position in the waiting queue ordering.
    let resumed = engine.resume_job(&job_ids[0]);
    assert!(resumed, "resume_job must accept a Paused job");

    {
        let state = engine.inner.state.lock_unpoisoned();
        let queue_ids: Vec<String> = state.queue.iter().cloned().collect();
        assert_eq!(
            queue_ids,
            vec![job_ids[0].clone(), job_ids[2].clone()],
            "after resume, queue should preserve the original execution ordering"
        );
    }
}

#[test]
fn enqueue_transcode_job_uses_container_extension_when_present() {
    // 构造一个显式声明 mkv 容器的预设。
    let mut preset = make_test_preset();
    preset.id = "preset-mkv".to_string();
    preset.container = Some(ContainerConfig {
        format: Some("mkv".to_string()),
        movflags: None,
    });

    let settings = AppSettings::default();
    let inner = Arc::new(Inner::new(vec![preset], settings));
    let engine = TranscodingEngine { inner };

    let job = engine.enqueue_transcode_job(
        "C:/videos/sample_input.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-mkv".into(),
    );

    let output_path = job
        .output_path
        .as_deref()
        .expect("output_path must be set for video job");
    assert!(
        output_path.ends_with("sample_input.compressed.mkv"),
        "当预设声明 container.format=mkv 时，入队的输出路径应使用 .compressed.mkv 扩展名，实际为 {output_path}"
    );
}

#[test]
fn crash_recovery_restores_paused_jobs_with_wait_metadata() {
    let engine = make_engine_with_preset();

    // Create a synthetic processing job with progress and a temp output.
    let temp_dir = env::temp_dir();
    let input_path = temp_dir.join("ffui_crash_recover_input.mp4");
    // A small placeholder file is enough; we never feed it to ffmpeg in this test.
    fs::write(&input_path, [0u8; 1024]).expect("write crash-recovery input file");

    let tmp_output = build_video_tmp_output_path(&input_path, None);
    fs::create_dir_all(
        tmp_output
            .parent()
            .unwrap_or_else(|| std::path::Path::new(".")),
    )
    .expect("create tmp output parent");
    fs::write(&tmp_output, [0u8; 2048]).expect("write crash-recovery tmp output");

    let job_id = "crash-recover-job".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.queue.push_back(job_id.clone());
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: input_path.to_string_lossy().into_owned(),
                job_type: JobType::Video,
                source: JobSource::Manual,
                queue_order: None,
                original_size_mb: 10.0,
                original_codec: Some("h264".to_string()),
                preset_id: "preset-1".to_string(),
                status: JobStatus::Processing,
                progress: 30.0,
                start_time: Some(current_time_millis()),
                end_time: None,
                processing_started_ms: None,
                elapsed_ms: None,
                output_size_mb: None,
                logs: Vec::new(),
                log_head: None,
                skip_reason: None,
                input_path: Some(input_path.to_string_lossy().into_owned()),
                output_path: None,
                output_policy: None,
                ffmpeg_command: None,
                runs: Vec::new(),
                media_info: Some(MediaInfo {
                    duration_seconds: Some(120.0),
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
                wait_metadata: None,
            },
        );
    }

    let snapshot = snapshot_queue_state(&engine.inner);

    // Simulate a fresh engine instance starting up and restoring from the
    // previously captured in-memory snapshot.
    let restored = make_engine_with_preset();
    restore_jobs_from_snapshot(&restored.inner, snapshot);

    let mut state = restored.inner.state.lock_unpoisoned();
    let restored_job = state
        .jobs
        .get(&job_id)
        .expect("restored job must be present after crash recovery");

    assert_eq!(
        restored_job.status,
        JobStatus::Paused,
        "processing job should be restored as Paused after crash"
    );
    assert!(
        restored_job.progress >= 30.0,
        "restored job should keep at least its previous progress, got {}",
        restored_job.progress
    );
    let meta = restored_job
        .wait_metadata
        .as_ref()
        .expect("restored job should carry wait_metadata");
    assert_eq!(
        meta.tmp_output_path.as_deref(),
        Some(tmp_output.to_string_lossy().as_ref()),
        "wait_metadata.tmp_output_path should reference the existing temp output"
    );

    // The restored queue must not start paused jobs automatically.
    assert!(
        state.queue.contains(&job_id),
        "paused job should remain visible in queue ordering after crash recovery"
    );
    let next = next_job_for_worker_locked(&mut state);
    assert!(
        next.is_none(),
        "paused job should not be selected automatically after crash recovery"
    );
}

#[test]
fn crash_recovery_does_not_reuse_job_ids_for_new_jobs() {
    let engine = make_engine_with_preset();

    // Enqueue a few jobs on the original engine and take a snapshot.
    let mut original_ids = Vec::new();
    for i in 0..3 {
        let job = engine.enqueue_transcode_job(
            format!("C:/videos/recover-id-{i}.mp4"),
            JobType::Video,
            JobSource::Manual,
            100.0,
            Some("h264".into()),
            "preset-1".into(),
        );
        original_ids.push(job.id.clone());
    }

    let snapshot = engine.queue_state();

    // Simulate a fresh engine process restoring from the persisted snapshot.
    let restored = make_engine_with_preset();
    restore_jobs_from_snapshot(&restored.inner, snapshot);

    // Enqueue a new job after recovery; it must get a fresh id that does not
    // collide with any restored job ids.
    let new_job = restored.enqueue_transcode_job(
        "C:/videos/recover-id-new.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    assert!(
        !original_ids.contains(&new_job.id),
        "newly enqueued job id {} must be unique after crash recovery",
        new_job.id
    );

    let state = restored.inner.state.lock_unpoisoned();
    assert_eq!(
        state.jobs.len(),
        original_ids.len() + 1,
        "restored engine must keep all previous jobs when new jobs are enqueued after recovery"
    );
}
