use super::*;
#[test]
fn queue_listener_observes_enqueue_and_cancel() {
    let dir = env::temp_dir();
    let path = dir.join("ffui_test_listener.mp4");

    {
        let mut file = File::create(&path).expect("create temp video file for listener test");
        let data = vec![0u8; 1024 * 1024];
        file.write_all(&data)
            .expect("write data to temp video file for listener test");
    }

    let engine = make_engine_with_preset();

    let snapshots: TestArc<TestMutex<Vec<QueueState>>> = TestArc::new(TestMutex::new(Vec::new()));
    let snapshots_clone = TestArc::clone(&snapshots);

    engine.register_queue_listener(move |state: QueueState| {
        snapshots_clone
            .lock()
            .expect("snapshots lock poisoned")
            .push(state);
    });

    let job = engine.enqueue_transcode_job(
        path.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    {
        let states = snapshots.lock().expect("snapshots lock poisoned");
        assert!(
            states.iter().any(|s| s.jobs.iter().any(|j| j.id == job.id)),
            "listener should receive a snapshot containing the enqueued job"
        );
    }

    let cancelled = engine.cancel_job(&job.id);
    assert!(cancelled, "cancel_job should succeed for enqueued job");

    {
        let states = snapshots.lock().expect("snapshots lock poisoned");
        assert!(
            states.iter().any(|s| s
                .jobs
                .iter()
                .any(|j| j.id == job.id && j.status == JobStatus::Cancelled)),
            "listener should receive a snapshot containing the cancelled job"
        );
    }

    let _ = fs::remove_file(&path);
}

#[test]
fn queue_state_exposes_stable_queue_order_for_waiting_jobs() {
    let engine = make_engine_with_preset();

    let first = engine.enqueue_transcode_job(
        "C:/videos/order-1.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    let second = engine.enqueue_transcode_job(
        "C:/videos/order-2.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    // Both jobs are in the waiting queue; queue_state should assign them
    // deterministic queueOrder values based on the in-memory queue.
    let state = engine.queue_state();
    let mut by_id = std::collections::HashMap::new();
    for job in state.jobs {
        by_id.insert(job.id.clone(), job);
    }

    let j1 = by_id
        .get(&first.id)
        .expect("first job present in queue_state");
    let j2 = by_id
        .get(&second.id)
        .expect("second job present in queue_state");

    assert_eq!(
        j1.queue_order,
        Some(0),
        "first enqueued job should have queueOrder 0"
    );
    assert_eq!(
        j2.queue_order,
        Some(1),
        "second enqueued job should have queueOrder 1"
    );

    // Simulate a worker taking the first job; it should no longer appear
    // in the scheduling queue, and subsequent snapshots should clear its
    // queueOrder while leaving the second job untouched.
    {
        let mut state_inner = engine
            .inner
            .state
            .lock()
            .expect("engine state poisoned for queueOrder test");
        let popped = state_inner.queue.pop_front();
        assert_eq!(
            popped,
            Some(first.id.clone()),
            "front of queue must be the first enqueued job"
        );
    }

    let state_after = engine.queue_state();
    let mut by_id_after = std::collections::HashMap::new();
    for job in state_after.jobs {
        by_id_after.insert(job.id.clone(), job);
    }

    let j1_after = by_id_after
        .get(&first.id)
        .expect("first job still present after dequeue");
    let j2_after = by_id_after
        .get(&second.id)
        .expect("second job still present after dequeue");

    assert!(
        j1_after.queue_order.is_none(),
        "job no longer in the waiting queue should not carry a queueOrder"
    );
    assert_eq!(
        j2_after.queue_order,
        Some(0),
        "remaining waiting job should shift to queueOrder 0"
    );
}
