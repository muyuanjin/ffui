use super::*;

#[test]
fn ffmpeg_pause_resume_does_not_drop_frames_after_multiple_cycles() {
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
    let output = dir.join("ffui_it_pause_resume_in.compressed.mkv");

    // Generate a slightly heavier input than the default helper so we have
    // enough time to issue a mid-run pause request.
    // Include an audio stream that is slightly longer than the video stream so
    // format-level durations can differ from video stream durations.
    let gen_status = Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-t",
            "2.0",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=1280x720:rate=30",
            "-t",
            "2.2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            // Use lossless input so we can do exact per-frame comparisons
            // between input and output (a dropped + duplicated frame would
            // keep counts equal but break the frame hash sequence).
            "0",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
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
        format: Some("matroska".to_string()),
        movflags: None,
    });
    preset.video.preset = "veryslow".to_string();
    preset.video.quality_value = 0;
    preset.video.pix_fmt = Some("yuv420p".to_string());

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
    let job_id = job.id;

    // Simulate worker selection: mark job Processing and set timing fields.
    let selected_id = {
        let mut state = engine.inner.state.lock_unpoisoned();
        next_job_for_worker_locked(&mut state).expect("job must be selectable for worker")
    };
    assert_eq!(selected_id, job_id);

    // Spawn the processor in a background thread and issue a pause request
    // after a short delay to exercise the cooperative wait path.
    let pause_once = |engine: &TranscodingEngine, job_id: &str| -> (PathBuf, f64) {
        let inner_clone = engine.inner.clone();
        let job_id_clone = job_id.to_string();
        let handle = std::thread::spawn(move || {
            process_transcode_job(&inner_clone, &job_id_clone)
                .expect("process_transcode_job must not error in pause phase");
        });

        std::thread::sleep(std::time::Duration::from_millis(250));
        assert!(
            wait_job(&engine.inner, job_id),
            "wait_job should accept a Processing job"
        );

        handle.join().expect("pause thread must join");

        let (segment_path, processed_seconds) = {
            let state = engine.inner.state.lock_unpoisoned();
            let stored = state.jobs.get(job_id).expect("job must exist");
            assert_eq!(
                stored.status,
                JobStatus::Paused,
                "job must be paused after wait"
            );
            assert!(
                stored.progress.is_finite() && stored.progress < 100.0,
                "paused job progress must remain < 100% (it should freeze at the moment of wait); got {}",
                stored.progress
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

        (segment_path, processed_seconds)
    };

    let (segment_path_0, processed_seconds_0) = pause_once(&engine, &job_id);

    // Resume and pause again to exercise multi-cycle pause/resume.
    assert!(
        resume_job(&engine.inner, &job_id),
        "resume_job must accept paused job"
    );
    let selected_id = {
        let mut state = engine.inner.state.lock_unpoisoned();
        next_job_for_worker_locked(&mut state).expect("resumed job must be selectable")
    };
    assert_eq!(selected_id, job_id);

    let (segment_path_1, processed_seconds_1) = pause_once(&engine, &job_id);
    assert!(
        processed_seconds_1 > processed_seconds_0,
        "processed_seconds should advance after an additional pause/resume cycle"
    );

    // Final resume: run until completion.
    assert!(
        resume_job(&engine.inner, &job_id),
        "resume_job must accept paused job for final completion"
    );
    let selected_id = {
        let mut state = engine.inner.state.lock_unpoisoned();
        next_job_for_worker_locked(&mut state).expect("resumed job must be selectable")
    };
    assert_eq!(selected_id, job_id);

    process_transcode_job(&engine.inner, &job_id).expect("process_transcode_job must complete");

    let status = {
        let state = engine.inner.state.lock_unpoisoned();
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

    fn probe_video_duration(path: &std::path::Path) -> Option<f64> {
        let output = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=duration",
                "-select_streams",
                "v:0",
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

    fn probe_frame_count(path: &std::path::Path) -> Option<u64> {
        let output = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-count_frames",
                "-show_entries",
                "stream=nb_read_frames",
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
        s.trim().parse::<u64>().ok()
    }

    fn probe_framemd5(path: &std::path::Path) -> Option<Vec<String>> {
        let output = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-i",
                path.to_string_lossy().as_ref(),
                "-map",
                "0:v:0",
                "-f",
                "framemd5",
                "-",
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }

        let s = String::from_utf8_lossy(&output.stdout);
        let mut hashes = Vec::new();
        for line in s.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            // format: stream_index, dts, pts, duration, size, md5
            let parts: Vec<&str> = line.split(',').map(str::trim).collect();
            if let Some(md5) = parts.get(5) {
                hashes.push((*md5).to_string());
            }
        }
        Some(hashes)
    }

    let input_dur = probe_video_duration(&input).expect("input video duration should be probeable");
    let out_dur = probe_video_duration(&output).expect("output video duration should be probeable");
    let input_frames = probe_frame_count(&input).expect("input frame count should be probeable");
    let out_frames = probe_frame_count(&output).expect("output frame count should be probeable");
    assert_eq!(
        out_frames, input_frames,
        "pause/resume should not duplicate/drop frames; input_frames={input_frames} out_frames={out_frames}"
    );
    assert!(
        (out_dur - input_dur).abs() <= 0.05,
        "output video duration should match input video duration closely; input={input_dur:.3}s output={out_dur:.3}s"
    );

    let input_hashes =
        probe_framemd5(&input).expect("input framemd5 should be probeable via ffmpeg");
    let output_hashes =
        probe_framemd5(&output).expect("output framemd5 should be probeable via ffmpeg");
    assert_eq!(
        input_hashes.len() as u64,
        input_frames,
        "framemd5 hash count must match probed input frame count"
    );
    assert_eq!(
        output_hashes.len() as u64,
        out_frames,
        "framemd5 hash count must match probed output frame count"
    );
    if input_hashes != output_hashes {
        let mismatch_idx = input_hashes
            .iter()
            .zip(output_hashes.iter())
            .position(|(a, b)| a != b);
        panic!(
            "pause/resume should preserve per-frame content (same timepoint -> same picture); first_mismatch_index={mismatch_idx:?}"
        );
    }

    let _ = fs::remove_file(&input);
    let _ = fs::remove_file(&output);
    let _ = fs::remove_file(&segment_path_0);
    let _ = fs::remove_file(&segment_path_1);
}
