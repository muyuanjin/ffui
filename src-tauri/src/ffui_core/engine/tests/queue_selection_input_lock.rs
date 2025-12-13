use super::*;

#[test]
fn worker_selection_skips_jobs_with_active_input_path() {
    let engine = make_engine_with_preset();

    let job1 = engine.enqueue_transcode_job(
        "C:/videos/dupe.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    let job2 = engine.enqueue_transcode_job(
        "C:/videos/dupe.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    let job3 = engine.enqueue_transcode_job(
        "C:/videos/other.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");

        let first = next_job_for_worker_locked(&mut state).expect("first selection");
        assert_eq!(first, job1.id, "first worker should take the FIFO job");
        assert!(
            state.active_inputs.contains("C:/videos/dupe.mp4"),
            "active input should be tracked for the running job"
        );

        let second = next_job_for_worker_locked(&mut state).expect("second selection");
        assert_eq!(
            second, job3.id,
            "second worker should skip duplicate-input job and take the next eligible job"
        );

        assert!(
            state.queue.contains(&job2.id),
            "blocked duplicate-input job should remain queued"
        );
    }
}

