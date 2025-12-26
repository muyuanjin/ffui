use super::*;

#[test]
fn wait_job_pauses_waiting_and_queued_jobs_without_reordering_queue() {
    let engine = make_engine_with_preset();

    let first = engine.enqueue_transcode_job(
        "C:/videos/wait-waiting-1.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    let second = engine.enqueue_transcode_job(
        "C:/videos/wait-waiting-2.mp4".to_string(),
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

    assert!(engine.wait_job(&first.id), "wait_job should accept a Waiting job");
    assert!(engine.wait_job(&second.id), "wait_job should accept a Queued job");

    let state = engine.inner.state.lock_unpoisoned();
    assert_eq!(
        state.jobs.get(&first.id).unwrap().status,
        JobStatus::Paused,
        "waiting job should transition to Paused"
    );
    assert_eq!(
        state.jobs.get(&second.id).unwrap().status,
        JobStatus::Paused,
        "queued job should transition to Paused"
    );
    let queue_ids: Vec<String> = state.queue.iter().cloned().collect();
    assert_eq!(
        queue_ids,
        vec![first.id, second.id],
        "wait_job should not reorder the waiting queue"
    );
}

