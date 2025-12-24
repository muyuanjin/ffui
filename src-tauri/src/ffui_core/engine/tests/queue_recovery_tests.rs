use super::*;

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
        vec![first.id.clone(), second.id.clone(), new_job.id.clone()],
        "persisted waiting jobs should be restored ahead of newly enqueued jobs"
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
        vec![job.id.clone()],
        "crash recovery merge should keep queue free of duplicates"
    );
}
