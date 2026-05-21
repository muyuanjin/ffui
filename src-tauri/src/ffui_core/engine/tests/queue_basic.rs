use super::*;
use crate::ffui_core::engine::job_runner::current_time_millis;
use crate::ffui_core::engine::state::restore_segment_probe::SegmentDirCache;
use std::sync::{Arc, Mutex};

fn make_batch_compress_media_child(id: &str, status: JobStatus, job_type: JobType) -> TranscodeJob {
    TranscodeJob {
        id: id.to_string(),
        filename: format!("C:/videos/{id}.mp4"),
        job_type,
        source: JobSource::BatchCompress,
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
        batch_id: Some("batch-resume-media".to_string()),
        batch_compress_saving_condition: None,
        wait_metadata: None,
    }
}

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
fn resume_job_enqueues_batch_compress_media_child_in_worker_queue() {
    let engine = make_engine_with_preset();

    let paused_image = "job-resume-batch-image".to_string();
    let queued_audio = "job-resume-batch-audio".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            paused_image.clone(),
            make_batch_compress_media_child(&paused_image, JobStatus::Paused, JobType::Image),
        );
        state.jobs.insert(
            queued_audio.clone(),
            make_batch_compress_media_child(&queued_audio, JobStatus::Queued, JobType::Audio),
        );
        state
            .active_batch_compress_media_jobs
            .insert(paused_image.clone());
        state
            .active_batch_compress_media_jobs
            .insert(queued_audio.clone());
        state.queue.push_back(queued_audio.clone());
    }

    assert!(
        engine.resume_job(&paused_image),
        "paused Batch Compress image child should be resumable",
    );
    assert!(
        engine.resume_job(&queued_audio),
        "queued Batch Compress audio child resume should be idempotent",
    );

    let state = engine.inner.state.lock_unpoisoned();
    assert_eq!(
        state
            .jobs
            .get(&paused_image)
            .expect("image child exists")
            .status,
        JobStatus::Queued
    );
    assert!(
        state.queue.iter().any(|id| id == &paused_image),
        "single resume must enqueue Batch Compress image children into the normal worker queue",
    );
    assert!(
        state.queue.iter().any(|id| id == &queued_audio),
        "idempotent resume must keep Batch Compress audio children in the normal worker queue",
    );
}

#[test]
fn restart_job_enqueues_batch_compress_media_children() {
    let engine = make_engine_with_preset();

    let paused_image = "job-restart-batch-image".to_string();
    let failed_audio = "job-restart-batch-audio".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            paused_image.clone(),
            make_batch_compress_media_child(&paused_image, JobStatus::Paused, JobType::Image),
        );
        state.jobs.insert(
            failed_audio.clone(),
            make_batch_compress_media_child(&failed_audio, JobStatus::Failed, JobType::Audio),
        );
        state
            .active_batch_compress_media_jobs
            .insert(paused_image.clone());
        state.queue.push_back(paused_image.clone());
    }

    assert!(
        engine.restart_job(&paused_image),
        "paused Batch Compress image child should be restartable",
    );
    assert!(
        engine.restart_job(&failed_audio),
        "failed Batch Compress audio child should restart through the normal worker queue",
    );

    let state = engine.inner.state.lock_unpoisoned();
    assert_eq!(
        state
            .jobs
            .get(&paused_image)
            .expect("image child exists")
            .status,
        JobStatus::Queued
    );
    assert!(
        state.queue.iter().any(|id| id == &paused_image),
        "paused Batch Compress media children must enter the normal worker queue"
    );
    assert_eq!(
        state
            .jobs
            .get(&failed_audio)
            .expect("audio child exists")
            .status,
        JobStatus::Queued
    );
    assert!(
        state.queue.iter().any(|id| id == &failed_audio),
        "failed Batch Compress media children must be queued for normal worker restart"
    );
}

#[test]
fn restart_job_reopens_processed_batch_compress_media_child_accounting() {
    let engine = make_engine_with_preset();
    let batch_id = "batch-resume-media".to_string();
    let failed_audio = "job-restart-reopen-batch-audio".to_string();
    let progress_snapshots = Arc::new(Mutex::new(Vec::<AutoCompressProgress>::new()));
    let progress_snapshots_for_listener = Arc::clone(&progress_snapshots);
    engine.register_batch_compress_listener(move |progress| {
        progress_snapshots_for_listener
            .lock()
            .expect("progress snapshots lock")
            .push(progress);
    });

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let mut batch = BatchCompressBatch::new(batch_id.clone(), "C:/videos".to_string(), 1);
        batch.status = BatchCompressBatchStatus::Completed;
        batch.total_candidates = 1;
        batch.total_processed = 1;
        batch.child_job_ids.push(failed_audio.clone());
        batch.processed_child_job_ids.insert(failed_audio.clone());
        batch.completed_at_ms = Some(current_time_millis());
        state.batch_compress_batches.insert(batch_id, batch);
        state.jobs.insert(
            failed_audio.clone(),
            make_batch_compress_media_child(&failed_audio, JobStatus::Failed, JobType::Audio),
        );
    }

    assert!(
        engine.restart_job(&failed_audio),
        "failed Batch Compress media child should restart",
    );

    let state = engine.inner.state.lock_unpoisoned();
    let batch = state
        .batch_compress_batches
        .get("batch-resume-media")
        .expect("batch should exist");
    assert_eq!(batch.status, BatchCompressBatchStatus::Running);
    assert_eq!(batch.total_candidates, 1);
    assert_eq!(batch.total_processed, 0);
    assert!(
        !batch.processed_child_job_ids.contains(&failed_audio),
        "restart must clear the prior processed marker so the rerun can count when it finishes",
    );
    let snapshots = progress_snapshots
        .lock()
        .expect("progress snapshots lock")
        .clone();
    let progress = snapshots
        .last()
        .expect("restart must publish a Batch Compress progress snapshot");
    assert_eq!(progress.batch_id, "batch-resume-media");
    assert_eq!(
        progress.total_processed, 0,
        "frontend observers must see the reopened child reduce totalProcessed",
    );
    assert_eq!(progress.completed_at_ms, 0);
}

#[test]
fn startup_restore_auto_pauses_batch_compress_media_children() {
    let engine = make_engine_with_preset();

    let queued_image = "job-startup-resume-batch-image".to_string();
    let extra_audio = "job-startup-resume-batch-audio".to_string();

    restore_jobs_from_snapshot(
        &engine.inner,
        crate::ffui_core::domain::QueueState {
            jobs: vec![
                make_batch_compress_media_child(&queued_image, JobStatus::Queued, JobType::Image),
                make_batch_compress_media_child(&extra_audio, JobStatus::Paused, JobType::Audio),
            ],
        },
    );

    assert_eq!(
        engine.resume_startup_auto_paused_jobs(),
        1,
        "restored queued media children should be registered for startup resume like other queued jobs",
    );

    let state = engine.inner.state.lock_unpoisoned();
    let image = state.jobs.get(&queued_image).expect("image child exists");
    assert_eq!(image.status, JobStatus::Queued);
    assert!(
        state.queue.iter().any(|id| id == &queued_image),
        "restored queued media children must be left in the runnable queue"
    );
    let audio = state.jobs.get(&extra_audio).expect("audio child exists");
    assert_eq!(audio.status, JobStatus::Paused);
    assert!(
        state.queue.iter().any(|id| id == &extra_audio),
        "restored paused media children must remain visible in queue ordering"
    );
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
fn worker_selection_picks_batch_compress_media_child() {
    let engine = make_engine_with_preset();

    let owned_media = "job-selection-owned-media".to_string();
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            owned_media.clone(),
            make_batch_compress_media_child(&owned_media, JobStatus::Queued, JobType::Image),
        );
        state
            .active_batch_compress_media_jobs
            .insert(owned_media.clone());
        state.queue.push_back(owned_media.clone());
    }

    let _video = engine.enqueue_transcode_job(
        "C:/videos/selection-fallback.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    let picked = {
        let mut state = engine.inner.state.lock_unpoisoned();
        next_job_for_worker_locked(&mut state).expect("video job should be selectable")
    };

    assert_eq!(
        picked, owned_media,
        "normal workers must pick Batch Compress media children from the normal queue",
    );

    let state = engine.inner.state.lock_unpoisoned();
    assert_eq!(
        state
            .jobs
            .get(&owned_media)
            .expect("owned media child exists")
            .status,
        JobStatus::Processing,
        "Batch Compress media child must be marked Processing by a normal worker",
    );
    assert!(
        state.active_jobs.contains(&owned_media),
        "Batch Compress media child must enter the normal active_jobs set",
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
fn cancel_then_delete_removes_job_once_worker_releases_slot() {
    let engine = make_engine_with_preset();

    let filename = "C:/videos/cancel-then-delete.mp4".to_string();
    let job = engine.enqueue_transcode_job(
        filename.clone(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let taken = next_job_for_worker_locked(&mut state).expect("job should be selected");
        assert_eq!(taken, job.id);
    }

    assert!(
        engine.cancel_job(&job.id),
        "cancel_job must succeed for a job in Processing status"
    );
    mark_job_cancelled(&engine.inner, &job.id).expect("mark_job_cancelled should succeed");

    // Simulate the worker thread releasing its active slot before deletion.
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.active_jobs.remove(&job.id);
        state.active_inputs.remove(&filename);
    }

    assert!(
        engine.delete_job(&job.id),
        "delete_job must accept cancelled jobs once they are not active"
    );

    let state = engine.inner.state.lock_unpoisoned();
    assert!(
        !state.jobs.contains_key(&job.id),
        "deleted job must be removed from jobs map"
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
                created_time_ms: None,
                modified_time_ms: None,
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
                batch_compress_saving_condition: None,
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
    assert!(
        restored_job.wait_metadata.is_none(),
        "startup restore should not probe the filesystem for crash recovery metadata"
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
    drop(state);

    assert_eq!(
        restored.resume_startup_auto_paused_jobs(),
        1,
        "startup resume should transition the job back to Queued"
    );

    {
        let mut state = restored.inner.state.lock_unpoisoned();
        let picked = next_job_for_worker_locked(&mut state).expect("job must be selectable");
        assert_eq!(picked, job_id, "expected resumed job to be selected");
    }

    let mut cache = SegmentDirCache::default();
    probe_crash_recovery_wait_metadata_for_processing_job_best_effort(
        &restored.inner,
        &job_id,
        &mut cache,
    );

    let state = restored.inner.state.lock_unpoisoned();
    let restored_job = state
        .jobs
        .get(&job_id)
        .expect("restored job must still exist");
    let meta = restored_job
        .wait_metadata
        .as_ref()
        .expect("wait_metadata should be recovered before processing");
    assert_eq!(
        meta.tmp_output_path.as_deref(),
        Some(tmp_output.to_string_lossy().as_ref()),
        "wait_metadata.tmp_output_path should reference the existing temp output"
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
