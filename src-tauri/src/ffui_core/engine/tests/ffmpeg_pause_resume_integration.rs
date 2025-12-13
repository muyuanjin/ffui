use super::*;

#[test]
fn ffmpeg_pause_resume_does_not_create_overlap_segments() {
    if !ffmpeg_available() {
        eprintln!("skipping pause/resume integration test because ffmpeg is not available");
        return;
    }

    let ffprobe_ok = Command::new("ffprobe")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ffprobe_ok {
        eprintln!("skipping pause/resume integration test because ffprobe is not available");
        return;
    }

    let dir = env::temp_dir();
    let input = dir.join("ffui_it_pause_resume_in.mp4");
    let output = dir.join("ffui_it_pause_resume_in.compressed.mp4");

    // Generate a slightly heavier input than the default helper so we have
    // enough time to issue a mid-run pause request.
    let gen_status = Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=1280x720:rate=30",
            "-t",
            "2.0",
            "-pix_fmt",
            "yuv420p",
            input.to_string_lossy().as_ref(),
        ])
        .status();
    if !matches!(gen_status, Ok(s) if s.success()) {
        eprintln!("skipping pause/resume integration test because input generation failed");
        return;
    }

    let mut preset = make_test_preset();
    preset.global = Some(GlobalConfig {
        overwrite_behavior: Some(OverwriteBehavior::Overwrite),
        log_level: Some("warning".to_string()),
        hide_banner: Some(true),
        enable_report: Some(false),
    });
    preset.container = Some(ContainerConfig {
        format: Some("mp4".to_string()),
        movflags: Some(vec!["faststart".to_string()]),
    });
    preset.video.preset = "veryslow".to_string();

    let mut settings = AppSettings::default();
    settings.tools.auto_download = false;
    settings.tools.ffmpeg_path = Some("ffmpeg".to_string());
    settings.tools.ffprobe_path = Some("ffprobe".to_string());

    let inner = TestArc::new(Inner::new(vec![preset], settings));
    let engine = TranscodingEngine { inner };

    let job = engine.enqueue_transcode_job(
        input.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );
    let job_id = job.id.clone();

    // Simulate worker selection: mark job Processing and set timing fields.
    let selected_id = {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        next_job_for_worker_locked(&mut state).expect("job must be selectable for worker")
    };
    assert_eq!(selected_id, job_id);

    // Spawn the processor in a background thread and issue a pause request
    // after a short delay to exercise the cooperative wait path.
    let inner_clone = engine.inner.clone();
    let job_id_clone = job_id.clone();
    let handle = std::thread::spawn(move || {
        process_transcode_job(&inner_clone, &job_id_clone)
            .expect("process_transcode_job must not error in pause phase");
    });

    std::thread::sleep(std::time::Duration::from_millis(250));
    assert!(
        wait_job(&engine.inner, &job_id),
        "wait_job should accept a Processing job"
    );

    handle.join().expect("pause thread must join");

    let (segment_path, processed_seconds) = {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        let stored = state.jobs.get(&job_id).expect("job must exist");
        assert_eq!(
            stored.status,
            JobStatus::Paused,
            "job must be paused after wait"
        );
        let meta = stored
            .wait_metadata
            .as_ref()
            .expect("wait_metadata must exist after wait");
        let seg = meta
            .tmp_output_path
            .as_ref()
            .expect("tmp_output_path must be set after wait")
            .clone();
        (PathBuf::from(seg), meta.processed_seconds.unwrap_or(0.0))
    };

    assert!(
        processed_seconds.is_finite() && processed_seconds > 0.05,
        "processed_seconds should reflect a real segment duration, got {processed_seconds}"
    );
    assert!(
        segment_path.exists(),
        "paused tmp output segment should exist on disk: {}",
        segment_path.display()
    );

    // Resume: enqueue and process again until completion.
    assert!(
        resume_job(&engine.inner, &job_id),
        "resume_job must accept paused job"
    );
    let selected_id = {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        next_job_for_worker_locked(&mut state).expect("resumed job must be selectable")
    };
    assert_eq!(selected_id, job_id);

    process_transcode_job(&engine.inner, &job_id).expect("process_transcode_job must complete");

    let status = {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        state
            .jobs
            .get(&job_id)
            .expect("job must exist")
            .status
            .clone()
    };
    assert_eq!(
        status,
        JobStatus::Completed,
        "job must complete after resume"
    );

    // Verify output duration does not exceed input duration by a noticeable
    // amount. Overlap bugs tend to make the output longer than the input.
    fn probe_duration(path: &std::path::Path) -> Option<f64> {
        let output = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path.to_string_lossy().as_ref(),
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let s = String::from_utf8_lossy(&output.stdout);
        s.trim().parse::<f64>().ok()
    }

    let input_dur = probe_duration(&input).expect("input duration should be probeable");
    let out_dur = probe_duration(&output).expect("output duration should be probeable");
    assert!(
        out_dur <= input_dur + 0.15,
        "output duration should not exceed input duration significantly; input={input_dur:.3}s output={out_dur:.3}s"
    );

    let _ = fs::remove_file(&input);
    let _ = fs::remove_file(&output);
    let _ = fs::remove_file(&segment_path);
}
