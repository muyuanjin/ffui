use super::*;

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
        let mut matches: Vec<std::path::PathBuf> = std::fs::read_dir(deps_dir)
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
                p.extension().is_none()
            })
            .collect();
        matches.sort_by(|a, b| {
            let a_m = std::fs::metadata(a).and_then(|m| m.modified()).ok();
            let b_m = std::fs::metadata(b).and_then(|m| m.modified()).ok();
            b_m.cmp(&a_m).then_with(|| a.cmp(b))
        });
        if let Some(path) = matches.into_iter().next() {
            return path;
        }
    }

    let crate_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target_root = crate_root.join("target");
    let direct_candidates = if cfg!(windows) {
        ["ffui-mock-ffmpeg.exe", "ffui_mock_ffmpeg.exe"]
    } else {
        ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"]
    };

    for profile in ["check-all", "debug", "release"] {
        for exe_name in direct_candidates {
            let direct = target_root.join(profile).join(exe_name);
            if direct.exists() {
                return direct;
            }
        }
        let deps_dir = target_root.join(profile).join("deps");
        if !deps_dir.exists() {
            continue;
        }
        let prefixes = ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"];
        let mut matches: Vec<std::path::PathBuf> = std::fs::read_dir(&deps_dir)
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
                p.extension().is_none()
            })
            .collect();
        matches.sort_by(|a, b| {
            let a_m = std::fs::metadata(a).and_then(|m| m.modified()).ok();
            let b_m = std::fs::metadata(b).and_then(|m| m.modified()).ok();
            b_m.cmp(&a_m).then_with(|| a.cmp(b))
        });
        if let Some(path) = matches.into_iter().next() {
            return path;
        }
    }

    panic!("unable to locate mock ffmpeg executable");
}

fn argv_value_after(args: &[String], option: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == option)
        .map(|pair| pair[1].clone())
}

fn pass_value(args: &[String]) -> Option<String> {
    argv_value_after(args, "-pass")
}

fn passlogfile_value(args: &[String]) -> Option<String> {
    argv_value_after(args, "-passlogfile")
}

fn argv_index(args: &[String], needle: &str) -> Option<usize> {
    args.iter().position(|arg| arg == needle)
}

fn captured_argvs(path: &std::path::Path) -> Vec<Vec<String>> {
    std::fs::read_to_string(path)
        .expect("read mock ffmpeg captures")
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter_map(|payload| payload.get("argv").and_then(|v| v.as_array()).cloned())
        .map(|argv| {
            argv.into_iter()
                .filter_map(|value| value.as_str().map(std::string::ToString::to_string))
                .collect::<Vec<_>>()
        })
        .collect()
}

#[test]
fn resumed_two_pass_segment_runs_pass_one_before_pass_two() {
    let _env_lock = lock_mock_ffmpeg_env();
    crate::ffui_core::tools::reset_tool_probe_cache_for_tests();
    let _env_guard = crate::test_support::EnvVarGuard::capture([
        "FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT",
        "FFUI_MOCK_FFMPEG_ENGINE_PROGRESS",
        "FFUI_MOCK_FFMPEG_CAPTURE_PATH",
        "FFUI_MOCK_FFMPEG_CAPTURE_APPEND",
        "FFUI_MOCK_FFPROBE_FORMAT_DURATION",
    ]);
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT", "1");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_ENGINE_PROGRESS", "1");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_CAPTURE_APPEND", "1");
    crate::test_support::set_env("FFUI_MOCK_FFPROBE_FORMAT_DURATION", "8.0\n");

    let dir = tempfile::tempdir().expect("tempdir");
    let capture_path = dir.path().join("captures.jsonl");
    crate::test_support::set_env(
        "FFUI_MOCK_FFMPEG_CAPTURE_PATH",
        capture_path.to_string_lossy().as_ref(),
    );

    let input = dir.path().join("input.mp4");
    let previous_segment = dir
        .path()
        .join("input.compressed.job-two-pass.seg0.tmp.mp4");
    std::fs::write(&input, b"input").expect("write input");
    std::fs::write(&previous_segment, b"segment0").expect("write previous segment");

    let mock_exe = locate_mock_ffmpeg_exe();
    let mut preset = make_test_preset();
    preset.video.rate_control = RateControlMode::Vbr;
    preset.video.bitrate_kbps = Some(1_800);
    preset.video.pass = Some(2);
    preset.audio.codec = AudioCodecType::Copy;
    preset.container = Some(ContainerConfig {
        format: Some("mp4".to_string()),
        movflags: None,
    });

    let mut settings = AppSettings::default();
    settings.tools.auto_download = false;
    settings.tools.ffmpeg_path = Some(mock_exe.to_string_lossy().into_owned());
    settings.tools.ffprobe_path = Some(mock_exe.to_string_lossy().into_owned());
    settings.resume_backtrack_seconds = Some(2.0);
    let inner = TestArc::new(Inner::new(vec![preset], settings));
    let engine = TranscodingEngine { inner };

    let mut job = crate::test_support::make_transcode_job_for_tests(
        "job-two-pass",
        JobStatus::Paused,
        25.0,
        Some(current_time_millis()),
    );
    job.filename = input.to_string_lossy().into_owned();
    job.input_path = Some(input.to_string_lossy().into_owned());
    job.output_path = Some(
        dir.path()
            .join("input.compressed.mp4")
            .to_string_lossy()
            .into_owned(),
    );
    job.wait_metadata = Some(WaitMetadata {
        last_progress_percent: Some(62.5),
        processed_wall_millis: Some(1_000),
        processed_seconds: Some(5.0),
        target_seconds: Some(5.0),
        progress_epoch: None,
        last_progress_out_time_seconds: None,
        last_progress_speed: None,
        last_progress_updated_at_ms: None,
        last_progress_frame: None,
        tmp_output_path: Some(previous_segment.to_string_lossy().into_owned()),
        segments: Some(vec![previous_segment.to_string_lossy().into_owned()]),
        segment_end_targets: Some(vec![5.0]),
    });
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(job.id.clone(), job);
        state.media_info_cache.insert(
            input.to_string_lossy().into_owned(),
            MediaInfo {
                duration_seconds: Some(8.0),
                width: None,
                height: None,
                frame_rate: Some(30.0),
                video_codec: Some("h264".to_string()),
                audio_codec: None,
                size_mb: None,
            },
        );
    }
    assert!(
        engine.resume_job("job-two-pass"),
        "resume_job should queue the paused job"
    );

    let selected = {
        let mut state = engine.inner.state.lock_unpoisoned();
        next_job_for_worker_locked(&mut state).expect("resumed job should be selectable")
    };
    assert_eq!(selected, "job-two-pass");

    process_transcode_job(&engine.inner, "job-two-pass").expect("process resumed two-pass job");

    let argvs = captured_argvs(&capture_path);
    let two_pass_runs: Vec<Vec<String>> = argvs
        .into_iter()
        .filter(|argv| argv.iter().any(|arg| arg == "-pass"))
        .collect();
    assert!(
        two_pass_runs.len() >= 2,
        "resumed two-pass job should launch pass 1 and pass 2; got {two_pass_runs:?}"
    );

    assert_eq!(
        pass_value(&two_pass_runs[0]).as_deref(),
        Some("1"),
        "resumed segment must run pass 1 analysis before pass 2"
    );
    assert_eq!(
        pass_value(&two_pass_runs[1]).as_deref(),
        Some("2"),
        "resumed segment must run pass 2 after analysis"
    );
    assert_eq!(
        passlogfile_value(&two_pass_runs[0]),
        passlogfile_value(&two_pass_runs[1]),
        "pass 1 and pass 2 for a resumed segment must share the current segment passlog prefix"
    );
    assert!(
        passlogfile_value(&two_pass_runs[0])
            .as_deref()
            .is_some_and(|prefix| prefix.contains("seg1.tmp.mp4.ffui2pass")),
        "resumed passlog prefix must be tied to the active segment, got {:?}",
        passlogfile_value(&two_pass_runs[0])
    );
    for (idx, argv) in two_pass_runs.iter().enumerate() {
        let copyts_idx =
            argv_index(argv, "-copyts").expect("resume overlap trim should insert -copyts");
        let ss_idx = argv_index(argv, "-ss").expect("resumed two-pass run should seek the input");
        let input_idx = argv_index(argv, "-i").expect("resumed two-pass run should read the input");
        assert!(
            copyts_idx < ss_idx && copyts_idx < input_idx,
            "pass {} should place -copyts before the input seek/input position; argv={argv:?}",
            idx + 1
        );
    }
}
