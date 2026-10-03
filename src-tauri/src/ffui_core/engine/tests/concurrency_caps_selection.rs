use super::*;

#[test]
fn worker_split_caps_use_saved_video_recipes_for_active_and_queued_jobs() {
    for remove in [false, true] {
        let mut preset = make_test_preset();
        preset.video.encoder = EncoderType::H264Nvenc;
        let settings = AppSettings {
            parallelism_mode: Some(crate::ffui_core::settings::TranscodeParallelismMode::Split),
            max_parallel_cpu_jobs: Some(4),
            max_parallel_hw_jobs: Some(1),
            ..Default::default()
        };
        let engine = TranscodingEngine {
            inner: Arc::new(Inner::new(vec![preset.clone()], settings)),
        };
        let jobs: Vec<_> = (0..4)
            .map(|index| {
                engine.enqueue_transcode_job(
                    format!("saved-{index}.mp4"),
                    JobType::Video,
                    JobSource::Manual,
                    1.0,
                    None,
                    preset.id.clone(),
                )
            })
            .collect();
        let mut state = engine.inner.state.lock_unpoisoned();
        assert_eq!(
            next_job_for_worker_locked(&mut state),
            Some(jobs[0].id.clone())
        );
        if remove {
            state.presets = Arc::new(vec![]);
        } else {
            Arc::make_mut(&mut state.presets)[0].video.encoder = EncoderType::Libx264;
        }
        assert!(next_job_for_worker_locked(&mut state).is_none());
        state.active_jobs.clear();
        state.active_inputs.clear();
        assert_eq!(
            next_job_for_worker_locked(&mut state),
            Some(jobs[1].id.clone())
        );
        assert!(next_job_for_worker_locked(&mut state).is_none());
    }
}

#[test]
fn generic_commands_classify_ordered_codec_arguments_without_consulting_presets() {
    for option in ["-c:v", "-c:v:0", "-codec:v:1", "-c:0", "-vcodec"] {
        let engine = make_engine_with_preset();
        let first = engine
            .enqueue_ffmpeg_job(crate::ffui_core::domain::FfmpegJobRequest {
                name: "hardware command".into(),
                args: vec![option.into(), "h264_nvenc".into(), "one.mkv".into()],
                working_directory: None,
            })
            .expect("first");
        engine
            .enqueue_ffmpeg_job(crate::ffui_core::domain::FfmpegJobRequest {
                name: "second command".into(),
                args: vec![option.into(), "hevc_nvenc".into(), "two.mkv".into()],
                working_directory: None,
            })
            .expect("second");
        let mut state = engine.inner.state.lock_unpoisoned();
        state.settings.parallelism_mode =
            Some(crate::ffui_core::settings::TranscodeParallelismMode::Split);
        state.settings.max_parallel_cpu_jobs = Some(4);
        state.settings.max_parallel_hw_jobs = Some(1);
        state.presets = Arc::new(vec![]);
        assert_eq!(next_job_for_worker_locked(&mut state), Some(first.id));
        assert!(next_job_for_worker_locked(&mut state).is_none(), "{option}");
    }
}

#[test]
fn generic_metadata_does_not_consume_a_hardware_slot() {
    let engine = make_engine_with_preset();
    let jobs: Vec<_> = (0..2)
        .map(|index| {
            engine
                .enqueue_ffmpeg_job(crate::ffui_core::domain::FfmpegJobRequest {
                    name: format!("cpu command {index}"),
                    args: vec![
                        "-metadata".into(),
                        "encoder=h264_nvenc".into(),
                        "-c:v".into(),
                        "libx264".into(),
                        format!("cpu-{index}.mkv"),
                    ],
                    working_directory: None,
                })
                .expect("enqueue")
        })
        .collect();
    let mut state = engine.inner.state.lock_unpoisoned();
    state.settings.parallelism_mode =
        Some(crate::ffui_core::settings::TranscodeParallelismMode::Split);
    state.settings.max_parallel_cpu_jobs = Some(2);
    state.settings.max_parallel_hw_jobs = Some(1);
    for job in jobs {
        assert_eq!(next_job_for_worker_locked(&mut state), Some(job.id));
    }
}

#[test]
fn worker_selection_stops_during_shutdown_and_settings_load_failure() {
    let engine = make_engine_with_preset();
    let job = engine.enqueue_transcode_job(
        "C:/queued.mp4".into(),
        JobType::Video,
        JobSource::Manual,
        1.0,
        None,
        "preset-1".into(),
    );
    let mut state = engine.inner.state.lock_unpoisoned();
    state.shutting_down = true;
    assert!(next_job_for_worker_locked(&mut state).is_none());
    assert_eq!(state.jobs[&job.id].status, JobStatus::Queued);
    state.shutting_down = false;
    state.settings_load_error = Some("read denied".into());
    assert!(next_job_for_worker_locked(&mut state).is_none());
    state.settings_load_error = None;
    assert_eq!(next_job_for_worker_locked(&mut state), Some(job.id));
}

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
        let mut state = engine.inner.state.lock_unpoisoned();
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
        let mut state = engine.inner.state.lock_unpoisoned();

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
