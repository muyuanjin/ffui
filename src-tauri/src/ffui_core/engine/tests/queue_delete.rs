use super::*;

#[test]
fn delete_job_only_allows_terminal_statuses() {
    let engine = TranscodingEngine::new().expect("failed to create engine");

    // Enqueue a waiting job.
    let job_waiting = engine.enqueue_transcode_job(
        "C:/videos/waiting.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        10.0,
        Some("h264".to_string()),
        "preset-1".to_string(),
    );

    // Simulate a completed job by cloning and inserting into state directly.
    let completed_id = "job-completed-delete-test".to_string();
    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        let mut completed = job_waiting.clone();
        completed.id = completed_id.clone();
        completed.status = JobStatus::Completed;
        completed.progress = 100.0;
        state.jobs.insert(completed_id.clone(), completed);
    }

    // Deleting a non-terminal job must fail and keep it in the snapshot.
    assert!(
        !engine.delete_job(&job_waiting.id),
        "non-terminal job should not be deletable",
    );
    let snapshot = engine.queue_state();
    assert!(
        snapshot.jobs.iter().any(|j| j.id == job_waiting.id),
        "waiting job must remain present after failed delete",
    );

    // Deleting a completed job must succeed and remove it from the snapshot.
    assert!(
        engine.delete_job(&completed_id),
        "completed job should be deletable",
    );
    let snapshot_after = engine.queue_state();
    assert!(
        !snapshot_after.jobs.iter().any(|j| j.id == completed_id),
        "completed job must be removed from queue state after delete",
    );
}
