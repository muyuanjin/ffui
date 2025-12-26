use super::*;

#[allow(dead_code)]
fn locate_mock_ffmpeg_exe() -> std::path::PathBuf {
    for key in [
        "CARGO_BIN_EXE_ffui-mock-ffmpeg",
        "CARGO_BIN_EXE_ffui_mock_ffmpeg",
    ] {
        if let Ok(path) = std::env::var(key)
            && !path.trim().is_empty()
        {
            let p = std::path::PathBuf::from(path);
            if p.exists() {
                return p;
            }
        }
    }

    if let Ok(current_exe) = std::env::current_exe()
        && let Some(deps_dir) = current_exe.parent()
        && deps_dir.exists()
    {
        let prefixes = ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"];
        let matches: Vec<std::path::PathBuf> = std::fs::read_dir(deps_dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| prefixes.iter().any(|prefix| n.starts_with(prefix)))
            })
            .filter(|p| {
                if !p.is_file() {
                    return false;
                }
                if cfg!(windows) {
                    return p
                        .extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| e.eq_ignore_ascii_case("exe"));
                }
                !p.extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
            })
            .collect();

        let mut exe_candidates: Vec<(std::path::PathBuf, Option<std::time::SystemTime>)> = matches
            .into_iter()
            .map(|p| {
                let modified = std::fs::metadata(&p).ok().and_then(|m| m.modified().ok());
                (p, modified)
            })
            .collect();
        exe_candidates.sort_by_key(|(p, modified)| (*modified, p.clone()));
        if let Some((p, _)) = exe_candidates.pop() {
            return p;
        }
    }

    let crate_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target_debug = crate_root.join("target").join("debug");
    let direct_candidates = if cfg!(windows) {
        ["ffui-mock-ffmpeg.exe", "ffui_mock_ffmpeg.exe"]
    } else {
        ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"]
    };
    for exe_name in direct_candidates {
        let direct = target_debug.join(exe_name);
        if direct.exists() {
            return direct;
        }
    }

    let deps_dir = target_debug.join("deps");
    if deps_dir.exists() {
        let prefixes = ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"];
        let matches: Vec<std::path::PathBuf> = std::fs::read_dir(&deps_dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| prefixes.iter().any(|prefix| n.starts_with(prefix)))
            })
            .collect();
        let mut exe_candidates: Vec<(std::path::PathBuf, Option<std::time::SystemTime>)> = matches
            .into_iter()
            .filter(|p| {
                if !p.is_file() {
                    return false;
                }
                if cfg!(windows) {
                    return p
                        .extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| e.eq_ignore_ascii_case("exe"));
                }
                !p.extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
            })
            .map(|p| {
                let modified = std::fs::metadata(&p).ok().and_then(|m| m.modified().ok());
                (p, modified)
            })
            .collect();
        exe_candidates.sort_by_key(|(p, modified)| (*modified, p.clone()));
        if let Some((p, _)) = exe_candidates.pop() {
            return p;
        }
    }

    panic!("unable to locate mock ffmpeg executable in target/debug");
}

#[test]
fn restart_job_cleans_partial_segments_for_non_processing_job() {
    let dir = tempfile::tempdir().expect("tempdir");
    let seg0 = dir.path().join("seg0.tmp.mp4");
    let seg1 = dir.path().join("seg1.tmp.mp4");
    std::fs::write(&seg0, b"seg0").expect("write seg0");
    std::fs::write(&seg1, b"seg1").expect("write seg1");
    let marker0 = noaudio_marker_path_for_segment(&seg0);
    let marker1 = noaudio_marker_path_for_segment(&seg1);
    std::fs::write(&marker0, b"").expect("write marker0");
    std::fs::write(&marker1, b"").expect("write marker1");

    let engine = make_engine_with_preset();
    let job = engine.enqueue_transcode_job(
        "C:/videos/restart-cleanup.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let stored = state.jobs.get_mut(&job.id).expect("job exists");
        stored.wait_metadata = Some(WaitMetadata {
            last_progress_percent: Some(12.0),
            processed_wall_millis: None,
            processed_seconds: Some(1.2),
            target_seconds: Some(1.2),
            last_progress_out_time_seconds: None,
            last_progress_frame: None,
            tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
            segments: Some(vec![
                seg0.to_string_lossy().into_owned(),
                seg1.to_string_lossy().into_owned(),
            ]),
            segment_end_targets: None,
        });
    }

    assert!(
        engine.restart_job(&job.id),
        "restart_job should accept waiting job"
    );
    assert!(!seg0.exists(), "seg0 should be deleted");
    assert!(!seg1.exists(), "seg1 should be deleted");
    assert!(!marker0.exists(), "marker0 should be deleted");
    assert!(!marker1.exists(), "marker1 should be deleted");

    let state = engine.inner.state.lock_unpoisoned();
    let stored = state.jobs.get(&job.id).expect("job exists");
    assert_eq!(stored.status, JobStatus::Waiting);
    assert!(
        stored.wait_metadata.is_none(),
        "wait_metadata should be cleared"
    );
}

#[test]
fn cancel_processing_job_cleans_partial_segments() {
    let dir = tempfile::tempdir().expect("tempdir");
    let seg0 = dir.path().join("seg0.tmp.mp4");
    let seg1 = dir.path().join("seg1.tmp.mp4");
    std::fs::write(&seg0, b"seg0").expect("write seg0");
    std::fs::write(&seg1, b"seg1").expect("write seg1");
    let marker0 = noaudio_marker_path_for_segment(&seg0);
    let marker1 = noaudio_marker_path_for_segment(&seg1);
    std::fs::write(&marker0, b"").expect("write marker0");
    std::fs::write(&marker1, b"").expect("write marker1");

    let engine = make_engine_with_preset();
    let job = engine.enqueue_transcode_job(
        "C:/videos/cancel-cleanup.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        assert_eq!(state.queue.pop_front(), Some(job.id.clone()));
        let stored = state.jobs.get_mut(&job.id).expect("job exists");
        stored.status = JobStatus::Processing;
        stored.wait_metadata = Some(WaitMetadata {
            last_progress_percent: Some(12.0),
            processed_wall_millis: None,
            processed_seconds: Some(1.2),
            target_seconds: Some(1.2),
            last_progress_out_time_seconds: None,
            last_progress_frame: None,
            tmp_output_path: Some(seg1.to_string_lossy().into_owned()),
            segments: Some(vec![
                seg0.to_string_lossy().into_owned(),
                seg1.to_string_lossy().into_owned(),
            ]),
            segment_end_targets: None,
        });
    }

    assert!(
        engine.cancel_job(&job.id),
        "cancel_job should accept processing job"
    );
    assert!(!seg0.exists(), "seg0 should be deleted");
    assert!(!seg1.exists(), "seg1 should be deleted");
    assert!(!marker0.exists(), "marker0 should be deleted");
    assert!(!marker1.exists(), "marker1 should be deleted");

    let state = engine.inner.state.lock_unpoisoned();
    assert!(
        state.cancelled_jobs.contains(&job.id),
        "cancelled_jobs should contain the job id after cancel_job"
    );
}

#[test]
fn mark_job_cancelled_cleans_segments_when_restarting_processing_job() {
    let dir = tempfile::tempdir().expect("tempdir");
    let seg0 = dir.path().join("seg0.tmp.mp4");
    std::fs::write(&seg0, b"seg0").expect("write seg0");
    let marker0 = noaudio_marker_path_for_segment(&seg0);
    std::fs::write(&marker0, b"").expect("write marker0");

    let engine = make_engine_with_preset();
    let job = engine.enqueue_transcode_job(
        "C:/videos/restart-processing-cleanup.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        assert_eq!(state.queue.pop_front(), Some(job.id.clone()));
        let stored = state.jobs.get_mut(&job.id).expect("job exists");
        stored.status = JobStatus::Processing;
        stored.wait_metadata = Some(WaitMetadata {
            last_progress_percent: Some(12.0),
            processed_wall_millis: None,
            processed_seconds: Some(1.2),
            target_seconds: Some(1.2),
            last_progress_out_time_seconds: None,
            last_progress_frame: None,
            tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
            segments: Some(vec![seg0.to_string_lossy().into_owned()]),
            segment_end_targets: None,
        });
    }

    assert!(
        engine.restart_job(&job.id),
        "restart_job should accept processing job"
    );
    mark_job_cancelled(&engine.inner, &job.id).expect("mark_job_cancelled should succeed");

    assert!(
        !seg0.exists(),
        "seg0 should be deleted after restart cancellation"
    );
    assert!(
        !marker0.exists(),
        "marker0 should be deleted after restart cancellation"
    );

    let state = engine.inner.state.lock_unpoisoned();
    let stored = state.jobs.get(&job.id).expect("job exists");
    assert_eq!(stored.status, JobStatus::Waiting);
    assert!(
        stored.wait_metadata.is_none(),
        "wait_metadata should be cleared"
    );
}

#[test]
fn remux_drop_audio_is_idempotent_when_marker_exists() {
    let dir = tempfile::tempdir().expect("tempdir");
    let seg = dir.path().join("seg.tmp.mp4");
    std::fs::write(&seg, b"seg").expect("write seg");
    let marker = noaudio_marker_path_for_segment(&seg);
    std::fs::write(&marker, b"").expect("write marker");

    remux_segment_drop_audio("ffmpeg-does-not-exist", &seg).expect("marker should short-circuit");
    assert!(seg.exists(), "segment should remain when short-circuited");
    assert!(marker.exists(), "marker should remain when short-circuited");
}

#[test]
fn finalize_resume_cleanup_removes_noaudio_marker_files() {
    let dir = tempfile::tempdir().expect("tempdir");
    let seg0 = dir.path().join("seg0.tmp.mkv");
    std::fs::write(&seg0, b"seg0").expect("write seg0");
    let marker0 = noaudio_marker_path_for_segment(&seg0);
    std::fs::write(&marker0, b"").expect("write marker0");

    let engine = make_engine_with_preset();
    let job = engine.enqueue_transcode_job(
        "C:/videos/finalize-cleanup.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    // Use a 1-segment list so `concat_video_segments()` falls back to a simple
    // filesystem copy (no ffmpeg invocation needed) while still exercising the
    // same finalize cleanup path.
    let preset = make_test_preset();
    let input_path = std::path::PathBuf::from("C:/videos/input.mp4");
    let output_path = dir.path().join("out.mkv");
    let segments = vec![seg0.clone()];

    finalize_resumed_job_output_for_tests(
        &engine.inner,
        &job.id,
        "ffmpeg-does-not-exist",
        &input_path,
        &output_path,
        &preset,
        &segments,
        None,
        &seg0,
        false,
    )
    .expect("finalize_resumed_job_output_for_tests should succeed");

    assert!(output_path.exists(), "final output should exist");
    assert!(!seg0.exists(), "segment should be deleted after finalize");
    assert!(
        !marker0.exists(),
        "noaudio marker should be deleted after finalize"
    );
}

#[test]
fn finalize_resume_refuses_suspiciously_short_concat_output_and_keeps_segments() {
    let _env_lock = lock_mock_ffmpeg_env();
    let _guard = crate::test_support::EnvVarGuard::capture([
        "FFUI_MOCK_FFPROBE_FORMAT_DURATION",
        "FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT",
        "FFUI_MOCK_FFMPEG_EXIT_CODE",
    ]);

    let mock_exe = locate_mock_ffmpeg_exe();
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT", "1");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_EXIT_CODE", "0");

    let dir = tempfile::tempdir().expect("tempdir");
    let seg0 = dir.path().join("seg0.tmp.mkv");
    let seg1 = dir.path().join("seg1.tmp.mkv");
    std::fs::write(&seg0, b"seg0").expect("write seg0");
    std::fs::write(&seg1, b"seg1").expect("write seg1");

    // Mock ffprobe returns a short duration for the joined output so the
    // finalize guard will refuse to produce a truncated final file.
    crate::test_support::set_env("FFUI_MOCK_FFPROBE_FORMAT_DURATION", "2.0\n");

    let mut settings = AppSettings::default();
    settings.tools.auto_download = false;
    settings.tools.ffprobe_path = Some(mock_exe.to_string_lossy().into_owned());
    let inner = TestArc::new(Inner::new(vec![make_test_preset()], settings));
    let engine = TranscodingEngine { inner };
    let job = engine.enqueue_transcode_job(
        "C:/videos/finalize-short-guard.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    let preset = make_test_preset();
    let input_path = std::path::PathBuf::from("C:/videos/input.mp4");
    let output_path = dir.path().join("out.mkv");
    let joined_video_tmp = output_path.with_extension("video.concat.tmp.mkv");

    let segments = vec![seg0.clone(), seg1.clone()];
    let segment_durations = vec![10.0_f64, 10.0_f64];
    let result = finalize_resumed_job_output_for_tests(
        &engine.inner,
        &job.id,
        mock_exe.to_string_lossy().as_ref(),
        &input_path,
        &output_path,
        &preset,
        &segments,
        Some(&segment_durations),
        &seg1,
        false,
    );

    assert!(
        result.is_err(),
        "finalize should fail when probed output duration is shorter than expected"
    );
    assert!(
        !output_path.exists(),
        "final output should not be created on failure"
    );
    assert!(
        joined_video_tmp.exists(),
        "joined video temp should remain for recovery/debugging"
    );
    assert!(seg0.exists(), "segments should be kept for recovery");
    assert!(seg1.exists(), "segments should be kept for recovery");
}

#[test]
fn overlap_trim_uses_stream_start_time_offset_when_copyts_enabled() {
    static ENV_MUTEX: once_cell::sync::Lazy<std::sync::Mutex<()>> =
        once_cell::sync::Lazy::new(|| std::sync::Mutex::new(()));
    let _guard = ENV_MUTEX.lock_unpoisoned();

    unsafe {
        std::env::set_var("FFUI_TEST_FFPROBE_STREAM_START_TIME_SECONDS", "5.0");
    }

    let mut preset = make_test_preset();
    preset.filters.vf_chain = None;

    let mut settings = AppSettings::default();
    settings.tools.auto_download = false;

    let inner = TestArc::new(Inner::new(vec![preset.clone()], settings.clone()));
    let engine = TranscodingEngine { inner };

    let job = engine.enqueue_transcode_job(
        "C:/videos/overlap-trim-start-time.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    let plan = ResumePlan {
        target_seconds: 10.0,
        seek_seconds: 7.0,
        trim_start_seconds: 3.0,
        trim_at_seconds: 10.0,
        backtrack_seconds: 3.0,
        strategy: ResumeStrategy::OverlapTrim,
    };
    let mut resume_target_seconds = Some(plan.target_seconds);
    let mut resume_plan = Some(plan);
    let mut existing_segments: Vec<std::path::PathBuf> = Vec::new();
    let input_path = std::path::PathBuf::from(&job.filename);
    let output_path = std::path::PathBuf::from("C:/videos/out.mp4");

    let (effective, _finalize, _mux_audio) = build_effective_preset_for_resume(
        ResumePresetBuildContext {
            inner: &engine.inner,
            job_id: &job.id,
            input_path: &input_path,
            settings_snapshot: &settings,
            output_path: &output_path,
            resume_target_seconds: &mut resume_target_seconds,
            resume_plan: &mut resume_plan,
            existing_segments: &mut existing_segments,
        },
        &preset,
    );

    let vf = effective.filters.vf_chain.unwrap_or_default();
    assert!(
        vf.contains("trim=start=15.000000"),
        "vf_chain should include start_time-adjusted trim start, got: {vf}"
    );

    unsafe {
        std::env::remove_var("FFUI_TEST_FFPROBE_STREAM_START_TIME_SECONDS");
    }
}
