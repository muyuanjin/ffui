use super::*;

#[test]
fn worker_selection_respects_unified_concurrency_cap() {
    let engine = make_engine_with_preset();

    let job1 = engine.enqueue_transcode_job(
        "C:/videos/u1.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );
    let job2 = engine.enqueue_transcode_job(
        "C:/videos/u2.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        state.settings.max_parallel_jobs = Some(1);

        let first = next_job_for_worker_locked(&mut state).expect("first selection");
        assert_eq!(first, job1.id);

        assert!(
            next_job_for_worker_locked(&mut state).is_none(),
            "unified cap=1 should block selecting another job while one is active"
        );

        state.active_jobs.remove(&job1.id);
        state.active_inputs.remove(&job1.filename);
        if let Some(job) = state.jobs.get_mut(&job1.id) {
            job.status = JobStatus::Completed;
        }

        let second = next_job_for_worker_locked(&mut state).expect("second selection");
        assert_eq!(second, job2.id);
    }
}

#[test]
fn worker_selection_respects_split_cpu_and_hardware_caps() {
    let mut cpu_preset = make_test_preset();
    cpu_preset.id = "cpu".to_string();
    cpu_preset.video.encoder = EncoderType::Libx264;

    let mut hw_preset = make_test_preset();
    hw_preset.id = "hw".to_string();
    hw_preset.video.encoder = EncoderType::H264Nvenc;

    let settings = AppSettings {
        parallelism_mode: Some(crate::ffui_core::settings::TranscodeParallelismMode::Split),
        max_parallel_cpu_jobs: Some(1),
        max_parallel_hw_jobs: Some(1),
        ..AppSettings::default()
    };

    let inner = Arc::new(Inner::new(vec![cpu_preset, hw_preset], settings));
    let engine = TranscodingEngine { inner };

    let cpu1 = engine.enqueue_transcode_job(
        "C:/videos/cpu1.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "cpu".into(),
    );
    let cpu2 = engine.enqueue_transcode_job(
        "C:/videos/cpu2.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "cpu".into(),
    );
    let hw1 = engine.enqueue_transcode_job(
        "C:/videos/hw1.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "hw".into(),
    );

    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");

        let first = next_job_for_worker_locked(&mut state).expect("first selection");
        assert_eq!(first, cpu1.id, "FIFO selection should take first CPU job");

        let second = next_job_for_worker_locked(&mut state).expect("second selection");
        assert_eq!(
            second, hw1.id,
            "split caps should skip blocked CPU job and select HW job"
        );

        assert!(
            next_job_for_worker_locked(&mut state).is_none(),
            "with cpu=1 and hw=1, no more jobs are eligible while both slots are occupied"
        );

        // Free the CPU slot and ensure the next CPU job becomes eligible.
        state.active_jobs.remove(&cpu1.id);
        state.active_inputs.remove(&cpu1.filename);
        if let Some(job) = state.jobs.get_mut(&cpu1.id) {
            job.status = JobStatus::Completed;
        }

        let third = next_job_for_worker_locked(&mut state).expect("third selection");
        assert_eq!(third, cpu2.id, "CPU slot freed; next CPU job should run");
    }
}
