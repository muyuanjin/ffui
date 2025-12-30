use super::*;
use crate::ffui_core::QueuePersistenceMode;

#[test]
fn crash_recovery_disabled_restores_only_resumable_jobs_from_persisted_snapshot() {
    let _persist_guard = crate::ffui_core::lock_persist_test_mutex_for_tests();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let sidecar_path = std::env::temp_dir().join(format!("ffui_queue_restore_none_{stamp}.json"));
    let _sidecar_guard =
        super::super::state_persist::override_queue_state_sidecar_path_for_tests(sidecar_path);

    let writer = make_engine_with_preset();
    let paused = writer.enqueue_transcode_job(
        "C:/videos/resume-only-paused.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    let completed = writer.enqueue_transcode_job(
        "C:/videos/resume-only-completed.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    {
        let mut state = writer.inner.state.lock_unpoisoned();
        state.settings.queue_persistence_mode = QueuePersistenceMode::CrashRecoveryLite;
        state.jobs.get_mut(&paused.id).unwrap().status = JobStatus::Paused;
        state.jobs.get_mut(&paused.id).unwrap().progress = 0.0;
        state.jobs.get_mut(&completed.id).unwrap().status = JobStatus::Completed;
    }
    assert!(
        writer.force_persist_queue_state_lite_now(),
        "expected writer to persist full snapshot in crash recovery mode"
    );

    let restored = make_engine_with_preset();
    {
        let mut state = restored.inner.state.lock_unpoisoned();
        state.settings.queue_persistence_mode = QueuePersistenceMode::None;
    }
    restore_jobs_from_persisted_queue(&restored.inner);

    let state = restored.inner.state.lock_unpoisoned();
    assert!(
        state.jobs.contains_key(&paused.id),
        "paused job should be restored when crash recovery is disabled"
    );
    assert!(
        !state.jobs.contains_key(&completed.id),
        "terminal job should not be restored when crash recovery is disabled"
    );
}

#[test]
fn crash_recovery_disabled_persists_resumable_jobs_for_forced_kill_recovery() {
    let _persist_guard = crate::ffui_core::lock_persist_test_mutex_for_tests();
    super::super::state_persist::reset_queue_persist_state_for_tests();

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let sidecar_path = std::env::temp_dir().join(format!("ffui_queue_persist_none_{stamp}.json"));
    let _sidecar_guard = super::super::state_persist::override_queue_state_sidecar_path_for_tests(
        sidecar_path.clone(),
    );

    let engine = make_engine_with_preset();
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.settings.queue_persistence_mode = QueuePersistenceMode::None;
    }

    let paused = engine.enqueue_transcode_job(
        "C:/videos/persist-none-paused.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    let completed = engine.enqueue_transcode_job(
        "C:/videos/persist-none-completed.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.get_mut(&paused.id).unwrap().status = JobStatus::Paused;
        state.jobs.get_mut(&completed.id).unwrap().status = JobStatus::Completed;
    }

    // Trigger the same persistence path used by normal queue updates.
    notify_queue_listeners(&engine.inner);

    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
    while std::time::Instant::now() < deadline {
        if sidecar_path.exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert!(
        sidecar_path.exists(),
        "expected a persisted snapshot to be written in none mode"
    );

    let raw = std::fs::read_to_string(&sidecar_path).expect("read persisted snapshot");
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).expect("persisted snapshot should be readable JSON");
    let ids: Vec<String> = parsed["jobs"]
        .as_array()
        .expect("persisted snapshot should contain jobs array")
        .iter()
        .filter_map(|job| job["id"].as_str().map(ToString::to_string))
        .collect();
    assert!(
        ids.contains(&paused.id),
        "paused job should be persisted in none mode"
    );
    assert!(
        !ids.contains(&completed.id),
        "terminal job should not be persisted in none mode"
    );
}

#[test]
fn crash_recovery_merges_persisted_queue_with_jobs_enqueued_before_restore() {
    use std::sync::atomic::Ordering;

    let engine = make_engine_with_preset();

    let first = engine.enqueue_transcode_job(
        "C:/videos/recover-merge-1.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    let second = engine.enqueue_transcode_job(
        "C:/videos/recover-merge-2.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    let snapshot = engine.queue_state();

    let restored = make_engine_with_preset();
    // Simulate the startup high watermark bump so new jobs won't collide.
    restored.inner.next_job_id.store(10_000, Ordering::SeqCst);

    let new_job = restored.enqueue_transcode_job(
        "C:/videos/recover-merge-new.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    restore_jobs_from_snapshot(&restored.inner, snapshot);

    let state = restored.inner.state.lock_unpoisoned();

    assert!(
        state.jobs.contains_key(&first.id) && state.jobs.contains_key(&second.id),
        "restored jobs must be present after merge recovery"
    );
    assert!(
        state.jobs.contains_key(&new_job.id),
        "newly enqueued job must remain present after merge recovery"
    );

    let queue_vec: Vec<String> = state.queue.iter().cloned().collect();
    assert_eq!(
        queue_vec,
        vec![first.id, second.id, new_job.id],
        "persisted waiting jobs should be restored ahead of newly enqueued jobs"
    );
}

#[test]
fn crash_recovery_restores_waiting_jobs_as_paused_and_preserves_queue_order() {
    let engine = make_engine_with_preset();

    let first = engine.enqueue_transcode_job(
        "C:/videos/recover-paused-order-1.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    let second = engine.enqueue_transcode_job(
        "C:/videos/recover-paused-order-2.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    let third = engine.enqueue_transcode_job(
        "C:/videos/recover-paused-order-3.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.get_mut(&second.id).unwrap().status = JobStatus::Queued;
    }

    let snapshot = engine.queue_state();

    let restored = make_engine_with_preset();
    restore_jobs_from_snapshot(&restored.inner, snapshot);

    let mut state = restored.inner.state.lock_unpoisoned();

    for id in [&first.id, &second.id, &third.id] {
        let job = state.jobs.get(id).expect("restored job exists");
        assert_eq!(
            job.status,
            JobStatus::Paused,
            "waiting-like jobs should be restored as Paused"
        );
    }

    let queue_vec: Vec<String> = state.queue.iter().cloned().collect();
    assert_eq!(
        queue_vec,
        vec![first.id, second.id, third.id],
        "restored paused jobs should preserve queue ordering"
    );

    let next = next_job_for_worker_locked(&mut state);
    assert!(
        next.is_none(),
        "restored queue should not start jobs automatically"
    );
}

#[test]
fn crash_recovery_preserves_wait_target_seconds() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/recover-target.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let stored = state.jobs.get_mut(&job.id).expect("job exists");
        stored.status = JobStatus::Paused;
        stored.progress = 40.0;
        stored.media_info = Some(MediaInfo {
            duration_seconds: Some(100.0),
            width: None,
            height: None,
            frame_rate: None,
            video_codec: None,
            audio_codec: None,
            size_mb: None,
        });
        stored.wait_metadata = Some(WaitMetadata {
            last_progress_percent: Some(40.0),
            processed_wall_millis: Some(1234),
            processed_seconds: Some(40.0),
            target_seconds: Some(40.0),
            progress_epoch: None,
            last_progress_out_time_seconds: None,
            last_progress_speed: None,
            last_progress_updated_at_ms: None,
            last_progress_frame: None,
            tmp_output_path: Some("C:/tmp/seg0.mkv".to_string()),
            segments: Some(vec!["C:/tmp/seg0.mkv".to_string()]),
            segment_end_targets: None,
        });
    }

    let snapshot = engine.queue_state();

    let restored = make_engine_with_preset();
    restore_jobs_from_snapshot(&restored.inner, snapshot);

    let state = restored.inner.state.lock_unpoisoned();
    let restored_job = state.jobs.get(&job.id).expect("restored job exists");
    let meta = restored_job
        .wait_metadata
        .as_ref()
        .expect("restored wait_metadata exists");
    assert_eq!(
        meta.target_seconds,
        Some(40.0),
        "crash recovery should preserve the join target semantics"
    );
}

#[test]
fn crash_recovery_dedupes_existing_queue_entries() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/recover-dupe.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.queue.push_back(job.id.clone());
    }

    restore_jobs_from_snapshot(&engine.inner, QueueState { jobs: Vec::new() });

    let state = engine.inner.state.lock_unpoisoned();
    let queue_vec: Vec<String> = state.queue.iter().cloned().collect();
    assert_eq!(
        queue_vec,
        vec![job.id],
        "crash recovery merge should keep queue free of duplicates"
    );
}
