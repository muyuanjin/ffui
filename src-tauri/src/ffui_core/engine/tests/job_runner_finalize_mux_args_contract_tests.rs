use super::*;

fn make_test_preset(keep_subtitles: bool) -> FFmpegPreset {
    FFmpegPreset {
        id: "preset-test".to_string(),
        name: "preset-test".to_string(),
        description: "test".to_string(),
        created_time_ms: None,
        description_i18n: None,
        global: None,
        input: None,
        mapping: None,
        video: VideoConfig {
            encoder: EncoderType::Libx264,
            rate_control: RateControlMode::Crf,
            quality_value: 23,
            preset: "medium".to_string(),
            tune: None,
            profile: None,
            bitrate_kbps: None,
            max_bitrate_kbps: None,
            buffer_size_kbits: None,
            pass: None,
            level: None,
            gop_size: None,
            bf: None,
            pix_fmt: None,
            b_ref_mode: None,
            rc_lookahead: None,
            spatial_aq: None,
            temporal_aq: None,
        },
        audio: AudioConfig {
            codec: AudioCodecType::Copy,
            bitrate: None,
            sample_rate_hz: None,
            channels: None,
            channel_layout: None,
            loudness_profile: None,
            target_lufs: None,
            loudness_range: None,
            true_peak_db: None,
        },
        filters: FilterConfig {
            scale: None,
            crop: None,
            fps: None,
            vf_chain: None,
            af_chain: None,
            filter_complex: None,
        },
        subtitles: keep_subtitles.then_some(SubtitlesConfig {
            strategy: Some(SubtitleStrategy::Keep),
            burn_in_filter: None,
        }),
        container: None,
        hardware: None,
        stats: PresetStats {
            usage_count: 0,
            total_input_size_mb: 0.0,
            total_output_size_mb: 0.0,
            total_time_seconds: 0.0,
            total_frames: 0.0,
            vmaf_count: 0,
            vmaf_sum: 0.0,
            vmaf_min: 0.0,
            vmaf_max: 0.0,
        },
        advanced_enabled: Some(false),
        ffmpeg_template: None,
        is_smart_preset: None,
    }
}

#[test]
fn build_mux_args_for_resumed_output_maps_streams_and_respects_subtitle_keep() {
    let joined_video = PathBuf::from("joined_video.tmp.mp4");
    let input_path = PathBuf::from("input.mp4");
    let mux_tmp = PathBuf::from("mux.tmp.mp4");
    let preset = make_test_preset(true);

    let args = build_mux_args_for_resumed_output(&joined_video, &input_path, &mux_tmp, &preset);

    let mux_out = mux_tmp.to_string_lossy().into_owned();
    assert!(
        args.windows(2)
            .any(|w| w[0] == "-progress" && w[1] == "pipe:2"),
        "mux args should emit structured progress to stderr"
    );
    assert!(
        args.contains(&"-nostdin".to_string()),
        "mux args should be non-interactive"
    );
    assert!(
        args.contains(&"-y".to_string()),
        "mux args should overwrite temp output"
    );
    assert!(
        args.contains(&"-shortest".to_string()),
        "mux args should include -shortest"
    );
    assert_eq!(
        args.last().map(std::string::String::as_str),
        Some(mux_out.as_str()),
        "last arg should be output path"
    );

    let joined = joined_video.to_string_lossy().into_owned();
    let input = input_path.to_string_lossy().into_owned();
    assert!(
        args.windows(4)
            .any(|w| w[0] == "-i" && w[1] == joined && w[2] == "-i" && w[3] == input),
        "mux args should include two inputs in order"
    );

    assert!(
        args.windows(2).any(|w| w[0] == "-map" && w[1] == "0:v:0"),
        "mux args should map video from joined segment"
    );
    assert!(
        args.windows(2).any(|w| w[0] == "-map" && w[1] == "0:s?"),
        "mux args should map subtitles from joined segment when keeping subtitles"
    );
    assert!(
        args.windows(2).any(|w| w[0] == "-map" && w[1] == "1:a?"),
        "mux args should map audio from original input"
    );

    assert!(
        args.windows(2).any(|w| w[0] == "-c:v" && w[1] == "copy"),
        "mux args should copy video stream"
    );
    assert!(
        args.windows(2).any(|w| w[0] == "-c:s" && w[1] == "copy"),
        "mux args should copy subtitle stream when keeping subtitles"
    );
    assert!(
        args.windows(2).any(|w| w[0] == "-c:a" && w[1] == "copy"),
        "mux args should copy audio stream for AudioCodecType::Copy"
    );
}

#[test]
fn audio_sidecar_args_reuse_serial_audio_encoding_and_filters() {
    let input_path = PathBuf::from("input.mp4");
    let audio_tmp = PathBuf::from("audio.tmp.m4a");
    let mut preset = make_test_preset(false);
    preset.audio.codec = AudioCodecType::Aac;
    preset.audio.bitrate = Some(160);
    preset.audio.sample_rate_hz = Some(48_000);
    preset.audio.channels = Some(2);
    preset.audio.loudness_profile = Some("ebuR128".to_string());
    preset.filters.af_chain = Some("aresample=async=1".to_string());

    let serial_mux_args = build_mux_args_for_resumed_output(
        &PathBuf::from("joined.mp4"),
        &input_path,
        &PathBuf::from("mux.tmp.mp4"),
        &preset,
    );
    let sidecar_args =
        build_audio_sidecar_args_for_resumed_output(&input_path, &audio_tmp, &preset);

    for expected in [
        vec!["-c:a", "aac"],
        vec!["-b:a", "160k"],
        vec!["-ar", "48000"],
        vec!["-ac", "2"],
    ] {
        assert!(
            serial_mux_args
                .windows(2)
                .any(|w| w[0] == expected[0] && w[1] == expected[1]),
            "serial mux args should contain {expected:?}"
        );
        assert!(
            sidecar_args
                .windows(2)
                .any(|w| w[0] == expected[0] && w[1] == expected[1]),
            "audio sidecar args should contain {expected:?}"
        );
    }

    let serial_filter = serial_mux_args
        .windows(2)
        .find(|w| w[0] == "-af")
        .map(|w| w[1].clone())
        .expect("serial mux should include audio filter");
    let sidecar_filter = sidecar_args
        .windows(2)
        .find(|w| w[0] == "-af")
        .map(|w| w[1].clone())
        .expect("audio sidecar should include audio filter");
    assert_eq!(sidecar_filter, serial_filter);
    assert!(sidecar_filter.contains("loudnorm="));
    assert!(sidecar_filter.contains("aresample=async=1"));
    assert!(
        sidecar_args
            .windows(2)
            .any(|w| w[0] == "-map" && w[1] == "0:a?")
    );
    assert!(sidecar_args.contains(&"-vn".to_string()));
    assert!(should_precompute_resumed_audio(&preset));
}

#[test]
fn processed_audio_mux_copies_audio_without_reapplying_filters() {
    let joined_video = PathBuf::from("joined_video.tmp.mp4");
    let processed_audio = PathBuf::from("audio.tmp.m4a");
    let mux_tmp = PathBuf::from("mux.tmp.mp4");
    let mut preset = make_test_preset(true);
    preset.audio.codec = AudioCodecType::Aac;
    preset.audio.loudness_profile = Some("ebuR128".to_string());

    let args = build_mux_args_for_resumed_output_with_processed_audio(
        &joined_video,
        &processed_audio,
        &mux_tmp,
        &preset,
    );

    assert!(
        args.windows(4).any(|w| {
            w[0] == "-i"
                && w[1] == joined_video.to_string_lossy()
                && w[2] == "-i"
                && w[3] == processed_audio.to_string_lossy()
        }),
        "processed-audio mux should use joined video and sidecar audio inputs"
    );
    assert!(args.windows(2).any(|w| w[0] == "-map" && w[1] == "0:v:0"));
    assert!(args.windows(2).any(|w| w[0] == "-map" && w[1] == "1:a?"));
    assert!(args.windows(2).any(|w| w[0] == "-c:v" && w[1] == "copy"));
    assert!(args.windows(2).any(|w| w[0] == "-c:a" && w[1] == "copy"));
    assert!(!args.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
    assert!(!args.iter().any(|arg| arg == "-af"));
    assert!(
        args.windows(2)
            .any(|w| w[0] == "-progress" && w[1] == "pipe:2"),
        "processed-audio mux should still emit progress telemetry"
    );
}

#[test]
fn audio_sidecar_is_only_enabled_for_reencoded_audio() {
    let copy_preset = make_test_preset(false);
    assert!(!should_precompute_resumed_audio(&copy_preset));

    let mut aac_preset = make_test_preset(false);
    aac_preset.audio.codec = AudioCodecType::Aac;
    assert!(should_precompute_resumed_audio(&aac_preset));
}

#[test]
fn audio_finalization_phase_duration_prefers_full_input_duration_over_resume_boundary() {
    assert_eq!(
        choose_audio_finalization_phase_duration(Some(3_600.0), Some(1_400.0)),
        Some(3_600.0),
        "audio sidecar transcodes the full input audio, so ETA must use input duration"
    );
    assert_eq!(
        choose_audio_finalization_phase_duration(None, Some(1_400.0)),
        Some(1_400.0),
        "fallback remains available when media duration is unknown"
    );
    assert_eq!(
        choose_audio_finalization_phase_duration(Some(0.0), Some(f64::NAN)),
        None
    );
}
