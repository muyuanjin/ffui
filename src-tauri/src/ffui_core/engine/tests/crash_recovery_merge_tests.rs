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
        vec![first.id, second.id, new_job.id],
        "persisted waiting jobs should be restored ahead of newly enqueued jobs"
    );
}
