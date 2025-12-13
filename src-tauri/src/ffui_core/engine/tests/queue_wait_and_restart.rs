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
    mark_job_waiting(&engine.inner, &job.id, &tmp, &out, Some(100.0), None)
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

#[test]
fn resume_cancels_pending_wait_request_and_logs_when_processing() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/resume-during-wait.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        80.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        assert_eq!(state.queue.pop_front(), Some(job.id.clone()));
        if let Some(j) = state.jobs.get_mut(&job.id) {
            j.status = JobStatus::Processing;
            j.progress = 50.0;
        }
        state.wait_requests.insert(job.id.clone());
    }

    let resumed = engine.resume_job(&job.id);
    assert!(
        resumed,
        "resume_job must cancel a pending wait request while job is processing"
    );

    let state = engine.inner.state.lock().expect("engine state poisoned");
    let stored = state
        .jobs
        .get(&job.id)
        .expect("job must remain present after cancelling wait");
    assert_eq!(
        stored.status,
        JobStatus::Processing,
        "cancelling wait request should not change job status mid-processing"
    );
    assert!(
        !state.wait_requests.contains(&job.id),
        "wait_requests set must remove the job after cancelling wait"
    );
    assert!(
        stored
            .logs
            .iter()
            .any(|entry| entry.contains("Resume requested while wait was pending")),
        "resume_job should append a log entry when cancelling a pending wait request"
    );
    assert!(
        !state.queue.contains(&job.id),
        "processing job should remain out of the waiting queue after cancelling wait"
    );
}

#[test]
fn resume_cancels_pending_wait_request_for_processing_job() {
    // 测试场景：用户快速连续点击"暂停→继续"时的竞态条件处理。
    // 当任务仍在 Processing 状态但存在待处理的 wait_request 时，
    // resume_job 应该取消该暂停请求，让任务继续运行。
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/rapid-pause-resume.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    // 模拟 worker 已经取走任务并开始处理
    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        assert_eq!(state.queue.pop_front(), Some(job.id.clone()));
        if let Some(j) = state.jobs.get_mut(&job.id) {
            j.status = JobStatus::Processing;
            j.progress = 30.0;
        }
    }

    // 用户点击暂停 - 这会设置 wait_request 但不会立即改变状态
    let wait_accepted = engine.wait_job(&job.id);
    assert!(wait_accepted, "wait_job must accept a Processing job");

    // 验证 wait_request 已设置，但状态仍是 Processing
    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        assert!(
            state.wait_requests.contains(&job.id),
            "wait_requests should contain the job id after wait_job"
        );
        let stored = state.jobs.get(&job.id).expect("job must exist");
        assert_eq!(
            stored.status,
            JobStatus::Processing,
            "job should still be Processing (wait is cooperative)"
        );
    }

    // 用户立即点击继续 - 在协作式暂停完成之前
    // 这应该取消待处理的暂停请求
    let resume_accepted = engine.resume_job(&job.id);
    assert!(
        resume_accepted,
        "resume_job must accept a Processing job with pending wait_request"
    );

    // 验证 wait_request 已被取消，任务继续处理
    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        assert!(
            !state.wait_requests.contains(&job.id),
            "wait_requests should be cleared after resume cancels the pending wait"
        );
        let stored = state.jobs.get(&job.id).expect("job must exist");
        assert_eq!(
            stored.status,
            JobStatus::Processing,
            "job should remain Processing after resume cancels pending wait"
        );
        assert!(
            (stored.progress - 30.0).abs() < f64::EPSILON,
            "progress should be unchanged"
        );
        // 验证日志记录了这个操作
        assert!(
            stored
                .logs
                .iter()
                .any(|log| log.contains("cancelling wait request")),
            "logs should record that the wait request was cancelled"
        );
    }
}

#[test]
fn resume_rejects_processing_job_without_pending_wait_request() {
    // 测试场景：对正在处理且没有待处理暂停请求的任务调用 resume 应该返回 false
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/no-pending-wait.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    // 模拟 worker 已经取走任务并开始处理
    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        assert_eq!(state.queue.pop_front(), Some(job.id.clone()));
        if let Some(j) = state.jobs.get_mut(&job.id) {
            j.status = JobStatus::Processing;
            j.progress = 50.0;
        }
    }

    // 直接调用 resume（没有先调用 wait）
    let resume_accepted = engine.resume_job(&job.id);
    assert!(
        !resume_accepted,
        "resume_job must reject a Processing job without pending wait_request"
    );

    // 验证状态没有改变
    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        let stored = state.jobs.get(&job.id).expect("job must exist");
        assert_eq!(
            stored.status,
            JobStatus::Processing,
            "job should remain Processing"
        );
    }
}

#[test]
fn rapid_pause_resume_pause_sequence_handles_correctly() {
    // 测试场景：用户快速连续点击"暂停→继续→暂停"
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/rapid-sequence.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    // 模拟 worker 已经取走任务并开始处理
    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        assert_eq!(state.queue.pop_front(), Some(job.id.clone()));
        if let Some(j) = state.jobs.get_mut(&job.id) {
            j.status = JobStatus::Processing;
            j.progress = 20.0;
        }
    }

    // 第一次暂停
    assert!(engine.wait_job(&job.id), "first wait_job must succeed");

    // 立即继续（取消暂停请求）
    assert!(
        engine.resume_job(&job.id),
        "resume_job must cancel pending wait"
    );

    // 再次暂停
    assert!(engine.wait_job(&job.id), "second wait_job must succeed");

    // 验证最终状态：有一个待处理的暂停请求
    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        assert!(
            state.wait_requests.contains(&job.id),
            "wait_requests should contain the job id after final wait_job"
        );
        let stored = state.jobs.get(&job.id).expect("job must exist");
        assert_eq!(
            stored.status,
            JobStatus::Processing,
            "job should still be Processing"
        );
    }

    // 模拟协作式暂停完成
    let tmp = PathBuf::from("C:/videos/rapid-sequence.compressed.tmp.mp4");
    let out = PathBuf::from("C:/videos/rapid-sequence.compressed.mp4");
    mark_job_waiting(&engine.inner, &job.id, &tmp, &out, Some(100.0), None)
        .expect("mark_job_waiting must succeed");

    // 验证任务现在是 Paused 状态
    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        let stored = state.jobs.get(&job.id).expect("job must exist");
        assert_eq!(
            stored.status,
            JobStatus::Paused,
            "job should be Paused after cooperative wait completes"
        );
    }
}
