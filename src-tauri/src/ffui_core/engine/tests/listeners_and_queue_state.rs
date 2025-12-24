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
        snapshots_clone.lock_unpoisoned().push(state);
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
        let states = snapshots.lock_unpoisoned();
        assert!(
            states.iter().any(|s| s.jobs.iter().any(|j| j.id == job.id)),
            "listener should receive a snapshot containing the enqueued job"
        );
    }

    let cancelled = engine.cancel_job(&job.id);
    assert!(cancelled, "cancel_job should succeed for enqueued job");

    {
        let states = snapshots.lock_unpoisoned();
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
fn queue_listener_observes_bulk_enqueue_as_single_snapshot() {
    let engine = make_engine_with_preset();

    let snapshots: TestArc<TestMutex<Vec<QueueState>>> = TestArc::new(TestMutex::new(Vec::new()));
    let snapshots_clone = TestArc::clone(&snapshots);

    engine.register_queue_listener(move |state: QueueState| {
        snapshots_clone.lock_unpoisoned().push(state);
    });

    let jobs = engine.enqueue_transcode_jobs(
        vec![
            "C:/videos/bulk-1.mp4".to_string(),
            "C:/videos/bulk-2.mkv".to_string(),
            "C:/videos/bulk-3.mp4".to_string(),
        ],
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    assert_eq!(jobs.len(), 3, "expected three enqueued jobs");

    let states = snapshots.lock_unpoisoned();
    assert_eq!(
        states.len(),
        1,
        "bulk enqueue should notify queue listeners once"
    );

    let state = &states[0];
    for job in jobs {
        assert!(
            state.jobs.iter().any(|j| j.id == job.id),
            "snapshot should include bulk-enqueued job {}",
            job.id
        );
    }
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
        let mut state_inner = engine.inner.state.lock_unpoisoned();
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

#[test]
fn queue_state_lite_strips_heavy_fields_but_keeps_required_metadata() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/lite.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    // Inject some heavy fields into the in-memory job so we can verify they
    // are not expanded in the lite snapshot.
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        if let Some(j) = state.jobs.get_mut(&job.id) {
            j.logs = vec!["line-1".into(), "line-2".into()];
            j.ffmpeg_command = Some("ffmpeg -i input -c:v libx264 output".into());
            j.log_tail = Some("tail-line".into());
        }
    }

    let lite = engine.queue_state_lite();
    assert_eq!(lite.jobs.len(), 1, "lite snapshot carries one job");

    let j = &lite.jobs[0];
    assert_eq!(j.id, job.id);
    assert_eq!(j.filename, job.filename);
    assert_eq!(j.preset_id, job.preset_id);
    assert!(matches!(j.status, JobStatus::Waiting));
    // Lite snapshot exposes metadata like queueOrder and media/output fields.
    assert_eq!(
        j.queue_order,
        Some(0),
        "lite snapshot should assign queueOrder 0 for the first waiting job"
    );
    // Heavy fields like the full `logs` vector must not be present on the
    // lite struct; they are only available via the full job detail endpoint.
    // (TranscodeJobLite does not carry a logs field, so we only assert on
    // presence of the lightweight log_tail marker here.)
    assert_eq!(
        j.log_tail.as_deref(),
        Some("tail-line"),
        "lite snapshot should surface a short log tail"
    );
    // The effective ffmpeg command line, however, is required by the UI for
    // both queue cards and the task detail dialog, so it must be preserved
    // on the lite snapshot.
    assert_eq!(
        j.ffmpeg_command.as_deref(),
        Some("ffmpeg -i input -c:v libx264 output"),
        "lite snapshot must carry ffmpeg_command so the UI can render commands"
    );
}

#[test]
fn enqueue_sets_planned_ffmpeg_command_before_processing_starts() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/planned-command.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    let detail = engine
        .job_detail(&job.id)
        .expect("enqueued job should exist");
    let cmd = detail
        .ffmpeg_command
        .as_deref()
        .unwrap_or_default()
        .to_string();

    assert!(
        !cmd.is_empty(),
        "planned ffmpeg_command should be set on enqueue"
    );
    assert!(
        cmd.contains("ffmpeg"),
        "planned command should include ffmpeg program token"
    );
    assert!(
        cmd.contains(".compressed."),
        "planned command should reference the final compressed output path"
    );
}

#[test]
fn queue_state_lite_uses_dedicated_builder_without_full_snapshot() {
    reset_snapshot_queue_state_calls();
    let engine = make_engine_with_preset();

    engine.enqueue_transcode_job(
        "C:/videos/lite-builder.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    let before_calls = snapshot_queue_state_calls();
    let _ = engine.queue_state_lite();

    assert_eq!(
        snapshot_queue_state_calls(),
        before_calls,
        "queue_state_lite should not invoke the full snapshot path"
    );
}

#[test]
fn queue_lite_listener_does_not_require_full_snapshot_builder() {
    reset_snapshot_queue_state_calls();
    let engine = make_engine_with_preset();

    let snapshots: TestArc<TestMutex<Vec<QueueStateLite>>> =
        TestArc::new(TestMutex::new(Vec::new()));
    let snapshots_clone = TestArc::clone(&snapshots);

    engine.register_queue_lite_listener(move |state: QueueStateLite| {
        snapshots_clone.lock_unpoisoned().push(state);
    });

    engine.enqueue_transcode_job(
        "C:/videos/lite-listener.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    assert_eq!(
        snapshot_queue_state_calls(),
        0,
        "lite listener hot path should not build full queue snapshots"
    );

    let states = snapshots.lock_unpoisoned();
    assert!(!states.is_empty(), "lite listener should receive updates");
}
