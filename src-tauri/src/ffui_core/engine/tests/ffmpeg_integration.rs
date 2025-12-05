use super::*;
#[test]
fn ffmpeg_integration_runs_x264_crf_preset_without_errors() {
    if !ffmpeg_available() {
        eprintln!("skipping x264 integration test because ffmpeg is not available");
        return;
    }

    let dir = env::temp_dir();
    let input = dir.join("ffui_it_x264_in.mp4");
    let output = dir.join("ffui_it_x264_out.mp4");

    if !generate_test_input_video(&input) {
        eprintln!("skipping x264 integration test because test input video generation failed");
        return;
    }

    let mut preset = make_test_preset();
    preset.global = Some(GlobalConfig {
        overwrite_behavior: Some(OverwriteBehavior::Overwrite),
        log_level: Some("error".to_string()),
        hide_banner: Some(true),
        enable_report: Some(false),
    });
    preset.filters.scale = Some("320:-2".to_string());
    preset.container = Some(ContainerConfig {
        format: Some("mp4".to_string()),
        movflags: Some(vec!["faststart".to_string()]),
    });

    let args = build_ffmpeg_args(&preset, &input, &output);
    let output_result = Command::new("ffmpeg")
        .args(&args)
        .output()
        .expect("spawn ffmpeg for x264 integration test");

    let stderr = String::from_utf8_lossy(&output_result.stderr);
    assert!(
        output_result.status.success(),
        "ffmpeg x264 integration preset must succeed, status={:?}, stderr={}",
        output_result.status.code(),
        stderr
    );
    assert!(
        !stderr.contains("Unrecognized option")
            && !stderr.contains("Filtering and streamcopy cannot be used together"),
        "ffmpeg stderr must not contain critical option/filtering errors, got: {stderr}"
    );

    let _ = fs::remove_file(&input);
    let _ = fs::remove_file(&output);
}

#[test]
fn ffmpeg_integration_runs_av1_crf_preset_when_encoder_available() {
    if !ffmpeg_available() {
        eprintln!("skipping AV1 integration test because ffmpeg is not available");
        return;
    }

    // Quick capability probe for libsvtav1; if the encoder is missing we
    // treat this as an environment limitation and skip instead of failing.
    let probe_status = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x90:rate=10",
            "-t",
            "0.25",
            "-c:v",
            "libsvtav1",
            "-f",
            "null",
            "-",
        ])
        .status();
    let can_use_av1 = matches!(probe_status, Ok(s) if s.success());
    if !can_use_av1 {
        eprintln!(
            "skipping AV1 integration test because libsvtav1 encoder is not usable in this environment"
        );
        return;
    }

    let dir = env::temp_dir();
    let input = dir.join("ffui_it_av1_in.mp4");
    let output = dir.join("ffui_it_av1_out.mp4");

    if !generate_test_input_video(&input) {
        eprintln!("skipping AV1 integration test because test input video generation failed");
        return;
    }

    let mut preset = make_test_preset();
    preset.video.encoder = EncoderType::LibSvtAv1;
    preset.video.rate_control = RateControlMode::Crf;
    preset.video.quality_value = 34;
    preset.video.preset = "6".to_string();
    preset.video.pix_fmt = Some("yuv420p10le".to_string());
    preset.global = Some(GlobalConfig {
        overwrite_behavior: Some(OverwriteBehavior::Overwrite),
        log_level: Some("warning".to_string()),
        hide_banner: Some(true),
        enable_report: Some(false),
    });
    preset.audio = AudioConfig {
        codec: AudioCodecType::Aac,
        bitrate: Some(128),
        sample_rate_hz: Some(48000),
        channels: Some(2),
        channel_layout: Some("stereo".to_string()),
        loudness_profile: None,
        target_lufs: None,
        loudness_range: None,
        true_peak_db: None,
    };
    preset.filters.scale = Some("-2:720".to_string());
    preset.filters.fps = Some(24);
    preset.container = Some(ContainerConfig {
        format: Some("mp4".to_string()),
        movflags: None,
    });

    let args = build_ffmpeg_args(&preset, &input, &output);
    let output_result = Command::new("ffmpeg")
        .args(&args)
        .output()
        .expect("spawn ffmpeg for AV1 integration test");

    let stderr = String::from_utf8_lossy(&output_result.stderr);
    if !output_result.status.success()
        && stderr.contains("Unknown encoder")
        && stderr.contains("libsvtav1")
    {
        eprintln!(
            "skipping AV1 integration assertion because libsvtav1 is not compiled in: {stderr}"
        );
        let _ = fs::remove_file(&input);
        let _ = fs::remove_file(&output);
        return;
    }

    assert!(
        output_result.status.success(),
        "ffmpeg AV1 integration preset must succeed when libsvtav1 is available, status={:?}, stderr={}",
        output_result.status.code(),
        stderr
    );
    assert!(
        !stderr.contains("Unrecognized option"),
        "ffmpeg stderr must not contain critical option errors for AV1 preset, got: {stderr}"
    );

    let _ = fs::remove_file(&input);
    let _ = fs::remove_file(&output);
}

#[test]
fn ffmpeg_integration_runs_stream_copy_preset_without_filtering_conflicts() {
    if !ffmpeg_available() {
        eprintln!("skipping stream copy integration test because ffmpeg is not available");
        return;
    }

    let dir = env::temp_dir();
    let input = dir.join("ffui_it_copy_in.mp4");
    let output = dir.join("ffui_it_copy_out.mp4");

    if !generate_test_input_video(&input) {
        eprintln!(
            "skipping stream copy integration test because test input video generation failed"
        );
        return;
    }

    let mut preset = make_test_preset();
    // Configure copy mode for both audio and video, and deliberately set
    // filter fields; build_ffmpeg_args must avoid emitting -vf/-filter_complex/-af
    // so that ffmpeg does not complain about filtering + streamcopy.
    preset.video.encoder = EncoderType::Copy;
    preset.audio.codec = AudioCodecType::Copy;
    preset.filters.scale = Some("320:-2".to_string());
    preset.filters.fps = Some(30);
    preset.filters.vf_chain = Some("eq=contrast=1.1".to_string());
    preset.filters.filter_complex = Some("[0:v]scale=320:-2[scaled]".to_string());
    preset.global = Some(GlobalConfig {
        overwrite_behavior: Some(OverwriteBehavior::Overwrite),
        log_level: Some("info".to_string()),
        hide_banner: Some(true),
        enable_report: Some(false),
    });
    preset.container = Some(ContainerConfig {
        format: Some("mp4".to_string()),
        movflags: None,
    });

    let args = build_ffmpeg_args(&preset, &input, &output);
    let output_result = Command::new("ffmpeg")
        .args(&args)
        .output()
        .expect("spawn ffmpeg for stream copy integration test");

    let stderr = String::from_utf8_lossy(&output_result.stderr);
    assert!(
        output_result.status.success(),
        "ffmpeg stream copy integration preset must succeed, status={:?}, stderr={}",
        output_result.status.code(),
        stderr
    );
    assert!(
        !stderr.contains("Filtering and streamcopy cannot be used together"),
        "ffmpeg stderr must not report filtering/streamcopy conflict, got: {stderr}"
    );

    let _ = fs::remove_file(&input);
    let _ = fs::remove_file(&output);
}
