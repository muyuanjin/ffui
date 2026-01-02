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
    assert_eq!(args.first().map(std::string::String::as_str), Some("-y"));
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
