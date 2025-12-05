use super::*;
#[test]
fn wait_and_resume_preserve_progress_and_queue_membership() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/wait-resume.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    // Simulate the worker having taken this job from the queue and made
    // some progress.
    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        // Pop the job from the queue as next_job_for_worker_locked would.
        assert_eq!(state.queue.pop_front(), Some(job.id.clone()));
        if let Some(j) = state.jobs.get_mut(&job.id) {
            j.status = JobStatus::Processing;
            j.progress = 40.0;
            j.media_info = Some(MediaInfo {
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

    // Request a wait operation from the frontend.
    let accepted = engine.wait_job(&job.id);
    assert!(accepted, "wait_job must accept a Processing job");

    // Cooperatively apply the wait in the worker loop.
    let tmp = PathBuf::from("C:/videos/wait-resume.compressed.tmp.mp4");
    let out = PathBuf::from("C:/videos/wait-resume.compressed.mp4");
    mark_job_waiting(&engine.inner, &job.id, &tmp, &out, Some(100.0))
        .expect("mark_job_waiting must succeed");

    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        let stored = state
            .jobs
            .get(&job.id)
            .expect("job must remain present after wait");
        assert_eq!(
            stored.status,
            JobStatus::Paused,
            "wait should transition job into Paused state"
        );
        assert!(
            (stored.progress - 40.0).abs() < f64::EPSILON,
            "wait should not reset overall progress"
        );
        assert!(
            !state.queue.contains(&job.id),
            "paused job should not be in the active scheduling queue until resumed"
        );
        let meta = stored
            .wait_metadata
            .as_ref()
            .expect("wait_metadata present");
        assert_eq!(
            meta.last_progress_percent,
            Some(40.0),
            "wait_metadata.last_progress_percent should capture last progress"
        );
        assert!(
            meta.processed_seconds.unwrap_or(0.0) > 0.0,
            "wait_metadata.processed_seconds should be derived from progress and duration"
        );
        assert_eq!(
            meta.tmp_output_path.as_deref(),
            Some(tmp.to_string_lossy().as_ref()),
            "wait_metadata.tmp_output_path should point to the temp output path"
        );
    }

    // Resume the job and ensure it re-enters the waiting queue without
    // losing progress or wait metadata.
    let resumed = engine.resume_job(&job.id);
    assert!(resumed, "resume_job must accept a Paused job");

    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        let stored = state
            .jobs
            .get(&job.id)
            .expect("job must remain present after resume");
        assert_eq!(
            stored.status,
            JobStatus::Waiting,
            "resume should transition job back to Waiting state"
        );
        assert!(
            (stored.progress - 40.0).abs() < f64::EPSILON,
            "resume should keep existing overall progress"
        );
        assert!(
            state.queue.contains(&job.id),
            "resumed job must re-enter the waiting queue"
        );
        assert!(
            stored.wait_metadata.is_some(),
            "wait_metadata should remain available after resume"
        );
    }

    // Finally, restart the job and verify progress is reset to 0% and
    // wait metadata cleared while the job remains enqueued.
    let restarted = engine.restart_job(&job.id);
    assert!(
        restarted,
        "restart_job must accept a non-terminal, non-processing job"
    );

    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        let stored = state
            .jobs
            .get(&job.id)
            .expect("job must remain present after restart");
        assert_eq!(
            stored.status,
            JobStatus::Waiting,
            "restart must reset job back to Waiting state"
        );
        assert!(
            (stored.progress - 0.0).abs() < f64::EPSILON,
            "restart must reset progress back to 0%"
        );
        assert!(
            stored.wait_metadata.is_none(),
            "restart must clear wait_metadata so the new run starts fresh"
        );
        assert!(
            state.queue.contains(&job.id),
            "restarted job must be present in the waiting queue"
        );
    }
}

#[test]
fn restart_processing_job_schedules_cooperative_cancel_and_fresh_run() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/restart-processing.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    // Simulate the worker having taken this job from the queue.
    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        assert_eq!(state.queue.pop_front(), Some(job.id.clone()));
        if let Some(j) = state.jobs.get_mut(&job.id) {
            j.status = JobStatus::Processing;
            j.progress = 25.0;
        }
    }

    let restarted = engine.restart_job(&job.id);
    assert!(restarted, "restart_job must accept a Processing job");

    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        assert!(
            state.cancelled_jobs.contains(&job.id),
            "restart_job must mark the job as cancelled for cooperative cancellation"
        );
        assert!(
            state.restart_requests.contains(&job.id),
            "restart_job must remember that the job should be restarted after cancellation"
        );
    }

    // Simulate the cooperative cancellation path.
    mark_job_cancelled(&engine.inner, &job.id)
        .expect("mark_job_cancelled must succeed for restart scenario");

    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        let stored = state
            .jobs
            .get(&job.id)
            .expect("job must remain present after cooperative restart");
        assert_eq!(
            stored.status,
            JobStatus::Waiting,
            "after cooperative restart the job must be back in Waiting state"
        );
        assert!(
            (stored.progress - 0.0).abs() < f64::EPSILON,
            "after cooperative restart progress must be reset to 0%"
        );
        assert!(
            state.queue.contains(&job.id),
            "after cooperative restart the job must be re-enqueued for a fresh run"
        );
        assert!(
            !state.cancelled_jobs.contains(&job.id),
            "cancelled_jobs set must be cleared after restart"
        );
        assert!(
            !state.restart_requests.contains(&job.id),
            "restart_requests set must be cleared after restart"
        );
    }
}
