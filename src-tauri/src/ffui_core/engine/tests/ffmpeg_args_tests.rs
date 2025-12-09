use super::*;
#[test]
fn build_ffmpeg_args_injects_progress_flags_for_standard_preset() {
    let preset = make_test_preset();
    let input = PathBuf::from("C:/Videos/input file.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");

    let args = build_ffmpeg_args(&preset, &input, &output, true);
    let joined = args.join(" ");

    assert!(
        joined.contains("-progress") && joined.contains("pipe:2"),
        "ffmpeg args must include -progress pipe:2 for structured progress, got: {joined}"
    );
}

#[test]
fn build_ffmpeg_args_can_enable_stdin_control_when_requested() {
    let preset = make_test_preset();
    let input = PathBuf::from("C:/Videos/input.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");

    let non_interactive = build_ffmpeg_args(&preset, &input, &output, true).join(" ");
    let interactive = build_ffmpeg_args(&preset, &input, &output, false).join(" ");

    assert!(
        non_interactive.contains("-nostdin"),
        "non_interactive=true must inject -nostdin to avoid unexpected stdin prompts, got: {non_interactive}"
    );
    assert!(
        !interactive.contains("-nostdin"),
        "non_interactive=false must NOT inject -nostdin so that the backend can send control commands (q\\n) over stdin, got: {interactive}"
    );
}

#[test]
fn build_ffmpeg_args_respects_existing_progress_flag_in_template() {
    let mut preset = make_test_preset();
    preset.advanced_enabled = Some(true);
    preset.ffmpeg_template =
        Some("-progress pipe:2 -i INPUT -c:v libx264 -crf 23 OUTPUT".to_string());

    let input = PathBuf::from("C:/Videos/input.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");
    let args = build_ffmpeg_args(&preset, &input, &output, true);

    let progress_flags = args.iter().filter(|a| a.as_str() == "-progress").count();
    assert_eq!(
        progress_flags, 1,
        "build_ffmpeg_args must not inject a duplicate -progress flag when template already specifies one"
    );
}

#[test]
fn build_ffmpeg_args_honors_structured_global_timeline_and_container_fields() {
    let mut preset = make_test_preset();
    preset.global = Some(GlobalConfig {
        overwrite_behavior: Some(OverwriteBehavior::Overwrite),
        log_level: Some("error".to_string()),
        hide_banner: Some(true),
        enable_report: Some(true),
    });
    preset.input = Some(InputTimelineConfig {
        seek_mode: Some(SeekMode::Input),
        seek_position: Some("00:00:10".to_string()),
        duration_mode: Some(DurationMode::Duration),
        duration: Some("5".to_string()),
        accurate_seek: Some(true),
    });
    preset.mapping = Some(MappingConfig {
        maps: Some(vec!["0:v:0".to_string(), "0:a:0".to_string()]),
        metadata: Some(vec!["title=Test".to_string()]),
        dispositions: Some(vec!["0:v:0 default".to_string()]),
    });
    preset.subtitles = Some(SubtitlesConfig {
        strategy: Some(SubtitleStrategy::Drop),
        burn_in_filter: None,
    });
    preset.container = Some(ContainerConfig {
        format: Some("mp4".to_string()),
        movflags: Some(vec!["faststart".to_string(), "frag_keyframe".to_string()]),
    });
    preset.hardware = Some(HardwareConfig {
        hwaccel: Some("cuda".to_string()),
        hwaccel_device: Some("cuda:0".to_string()),
        hwaccel_output_format: Some("cuda".to_string()),
        bitstream_filters: Some(vec!["h264_mp4toannexb".to_string()]),
    });

    let input = PathBuf::from("C:/Videos/input.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");
    let args = build_ffmpeg_args(&preset, &input, &output, true);
    let joined = args.join(" ");

    assert!(
        joined.contains("-y"),
        "structured preset with overwrite_behavior=Overwrite must emit -y, got: {joined}"
    );
    assert!(
        joined.contains("-loglevel error"),
        "structured preset with log_level must emit -loglevel flag, got: {joined}"
    );
    assert!(
        joined.contains("-hide_banner"),
        "structured preset with hide_banner=true must emit -hide_banner, got: {joined}"
    );
    assert!(
        joined.contains("-report"),
        "structured preset with enable_report=true must emit -report, got: {joined}"
    );
    assert!(
        joined.contains("-ss 00:00:10"),
        "structured preset with seek_position must emit -ss, got: {joined}"
    );
    assert!(
        joined.contains("-t 5"),
        "structured preset with duration_mode=Duration must emit -t, got: {joined}"
    );
    assert!(
        joined.contains("-map 0:v:0") && joined.contains("-map 0:a:0"),
        "structured preset with maps must emit -map directives, got: {joined}"
    );
    assert!(
        joined.contains("-metadata title=Test"),
        "structured preset with metadata must emit -metadata pairs, got: {joined}"
    );
    assert!(
        joined.contains("-disposition 0:v:0 default"),
        "structured preset with dispositions must emit -disposition, got: {joined}"
    );
    assert!(
        joined.contains("-sn"),
        "structured preset with SubtitleStrategy::Drop must emit -sn, got: {joined}"
    );
    assert!(
        joined.contains("-f mp4"),
        "structured preset with container.format must emit -f, got: {joined}"
    );
    assert!(
        joined.contains("-movflags faststart+frag_keyframe"),
        "structured preset with movflags must combine them with '+', got: {joined}"
    );
    assert!(
        joined.contains("-hwaccel cuda")
            && joined.contains("-hwaccel_device cuda:0")
            && joined.contains("-hwaccel_output_format cuda"),
        "structured preset with hardware settings must emit hwaccel flags, got: {joined}"
    );
    assert!(
        joined.contains("-bsf h264_mp4toannexb"),
        "structured preset with bitstreamFilters must emit -bsf flags, got: {joined}"
    );
}

#[test]
fn build_ffmpeg_args_normalizes_mkv_container_to_matroska_muxer() {
    let mut preset = make_test_preset();
    preset.container = Some(ContainerConfig {
        format: Some("mkv".to_string()),
        movflags: None,
    });

    let input = PathBuf::from("C:/Videos/input.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");

    let args = build_ffmpeg_args(&preset, &input, &output, true);
    let joined = args.join(" ");

    assert!(
        joined.contains("-f matroska"),
        "preset with container.format=mkv must emit -f matroska so ffmpeg accepts the muxer, got: {joined}"
    );
    assert!(
        !joined.contains("-f mkv"),
        "preset with container.format=mkv must NOT emit -f mkv (unsupported alias in some ffmpeg builds), got: {joined}"
    );
}

#[test]
fn build_ffmpeg_args_never_mixes_crf_cq_with_bitrate_or_two_pass_flags() {
    let mut preset = make_test_preset();

    let input = PathBuf::from("C:/Videos/input.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");

    let encoders = [
        EncoderType::Libx264,
        EncoderType::HevcNvenc,
        EncoderType::LibSvtAv1,
    ];
    let modes = [
        RateControlMode::Crf,
        RateControlMode::Cq,
        RateControlMode::Constqp,
        RateControlMode::Cbr,
        RateControlMode::Vbr,
    ];

    for encoder in encoders {
        for mode in &modes {
            preset.video.encoder = encoder.clone();
            preset.video.rate_control = mode.clone();
            preset.video.quality_value = 25;
            preset.video.bitrate_kbps = Some(3000);
            preset.video.max_bitrate_kbps = Some(4000);
            preset.video.buffer_size_kbits = Some(6000);
            preset.video.pass = Some(2);

            let args = build_ffmpeg_args(&preset, &input, &output, true);
            let joined = args.join(" ");

            let has_crf = joined.contains(" -crf ");
            let has_cq = joined.contains(" -cq ");
            let has_constqp = joined.contains("-rc constqp");
            let has_bitrate = joined.contains(" -b:v ");
            let has_maxrate = joined.contains(" -maxrate ");
            let has_bufsize = joined.contains(" -bufsize ");
            let has_pass = joined.contains(" -pass ");

            match mode {
                RateControlMode::Crf => {
                    assert!(has_crf, "Crf mode must emit -crf, got: {joined}");
                    assert!(
                        !has_cq && !has_bitrate && !has_maxrate && !has_bufsize && !has_pass,
                        "Crf mode must not emit CQ/bitrate/two-pass flags, got: {joined}"
                    );
                }
                RateControlMode::Cq => {
                    assert!(has_cq, "Cq mode must emit -cq, got: {joined}");
                    assert!(
                        !has_crf
                            && !has_constqp
                            && !has_bitrate
                            && !has_maxrate
                            && !has_bufsize
                            && !has_pass,
                        "Cq mode must not emit CRF/bitrate/two-pass flags, got: {joined}"
                    );
                }
                RateControlMode::Constqp => {
                    assert!(
                        has_constqp && joined.contains("-qp "),
                        "Constqp mode must emit -rc constqp and -qp, got: {joined}"
                    );
                    assert!(
                        !has_crf
                            && !has_cq
                            && !has_bitrate
                            && !has_maxrate
                            && !has_bufsize
                            && !has_pass,
                        "Constqp mode must not emit CRF/CQ/bitrate/two-pass flags, got: {joined}"
                    );
                }
                RateControlMode::Cbr | RateControlMode::Vbr => {
                    assert!(
                        !has_crf && !has_cq && !has_constqp,
                        "CBR/VBR modes must not emit CRF/CQ/ConstQP flags, got: {joined}"
                    );
                    assert!(
                        has_bitrate || has_maxrate || has_bufsize || has_pass,
                        "CBR/VBR modes must emit at least one bitrate-related flag, got: {joined}"
                    );
                }
            }
        }
    }
}

#[test]
fn build_ffmpeg_args_respects_audio_copy_vs_aac_flags() {
    let mut preset = make_test_preset();
    preset.audio.bitrate = Some(192);
    preset.audio.sample_rate_hz = Some(44100);
    preset.audio.channels = Some(2);
    preset.audio.channel_layout = Some("stereo".to_string());

    let input = PathBuf::from("C:/Videos/input.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");

    // copy mode: only -c:a copy, no re-encode flags.
    preset.audio.codec = AudioCodecType::Copy;
    let copy_args = build_ffmpeg_args(&preset, &input, &output, true).join(" ");
    assert!(
        copy_args.contains("-c:a copy"),
        "audio copy mode must emit -c:a copy, got: {copy_args}"
    );
    assert!(
        !copy_args.contains(" -b:a ")
            && !copy_args.contains(" -ar ")
            && !copy_args.contains(" -ac ")
            && !copy_args.contains(" -channel_layout "),
        "audio copy mode must not emit re-encode flags, got: {copy_args}"
    );

    // aac mode: re-encode flags must be present.
    preset.audio.codec = AudioCodecType::Aac;
    let aac_args = build_ffmpeg_args(&preset, &input, &output, true).join(" ");
    assert!(
        aac_args.contains("-c:a aac"),
        "audio aac mode must emit -c:a aac, got: {aac_args}"
    );
    assert!(
        aac_args.contains("-b:a 192k")
            && aac_args.contains("-ar 44100")
            && aac_args.contains("-ac 2")
            && aac_args.contains("-channel_layout stereo"),
        "audio aac mode must emit bitrate/sample rate/channel/layout flags, got: {aac_args}"
    );
}

#[test]
fn build_ffmpeg_args_applies_subtitle_strategies_to_vf_and_sn_consistently() {
    let mut preset = make_test_preset();
    preset.filters.scale = Some("1280:-2".to_string());
    preset.filters.fps = Some(30);

    let input = PathBuf::from("C:/Videos/input.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");

    // burn-in: vf chain contains burn-in filter, no -sn.
    preset.subtitles = Some(SubtitlesConfig {
        strategy: Some(SubtitleStrategy::BurnIn),
        burn_in_filter: Some("subtitles=INPUT:si=0".to_string()),
    });

    let burn_args = build_ffmpeg_args(&preset, &input, &output, true).join(" ");
    assert!(
        burn_args.contains("-vf "),
        "burn-in subtitles must emit -vf chain, got: {burn_args}"
    );
    assert!(
        burn_args.contains("scale=1280:-2")
            && burn_args.contains("fps=30")
            && burn_args.contains("subtitles=INPUT:si=0"),
        "burn-in subtitles must merge scale/fps/filter into vf chain, got: {burn_args}"
    );
    assert!(
        !burn_args.contains(" -sn"),
        "burn-in subtitles must not emit -sn, got: {burn_args}"
    );

    // drop: -sn present, vf chain has no burn-in expression.
    preset.subtitles = Some(SubtitlesConfig {
        strategy: Some(SubtitleStrategy::Drop),
        burn_in_filter: None,
    });

    let drop_args = build_ffmpeg_args(&preset, &input, &output, true).join(" ");
    assert!(
        drop_args.contains(" -sn") || drop_args.ends_with("-sn"),
        "drop subtitles strategy must emit -sn, got: {drop_args}"
    );
    assert!(
        !drop_args.contains("subtitles=INPUT:si=0"),
        "drop subtitles must not keep burn-in filter in vf chain, got: {drop_args}"
    );
}

#[test]
fn build_ffmpeg_args_skips_video_filters_when_encoder_is_copy() {
    let mut preset = make_test_preset();
    preset.video.encoder = EncoderType::Copy;
    preset.filters.scale = Some("1280:-2".to_string());
    preset.filters.crop = Some("iw:ih-100:0:100".to_string());
    preset.filters.fps = Some(30);
    preset.filters.vf_chain = Some("eq=contrast=1.1:brightness=0.05".to_string());
    preset.filters.filter_complex = Some("[0:v]scale=1280:-2[scaled]".to_string());

    let input = PathBuf::from("C:/Videos/input.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");
    let joined = build_ffmpeg_args(&preset, &input, &output, true).join(" ");

    assert!(
        joined.contains("-c:v copy"),
        "copy encoder must still emit -c:v copy flag, got: {joined}"
    );
    assert!(
        !joined.contains(" -vf ")
            && !joined.contains(" -filter_complex ")
            && !joined.ends_with(" -vf")
            && !joined.ends_with(" -filter_complex"),
        "copy encoder must not emit -vf or -filter_complex even when filters are configured, got: {joined}"
    );
}

#[test]
fn build_ffmpeg_args_skips_audio_filters_when_codec_is_copy() {
    let mut preset = make_test_preset();
    // Audio codec defaults to Copy in make_test_preset; ensure an af_chain is configured.
    preset.filters.af_chain = Some("acompressor=threshold=-18dB".to_string());

    let input = PathBuf::from("C:/Videos/input.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");
    let joined = build_ffmpeg_args(&preset, &input, &output, true).join(" ");

    assert!(
        joined.contains("-c:a copy"),
        "audio copy mode must emit -c:a copy, got: {joined}"
    );
    assert!(
        !joined.contains(" -af ")
            && !joined.ends_with(" -af")
            && !joined.contains("-af acompressor"),
        "audio copy mode must not emit -af even when af_chain is configured, got: {joined}"
    );
}

#[test]
fn build_ffmpeg_args_supports_constqp_nvenc_hq_with_aac_loudness() {
    let mut preset = make_test_preset();
    preset.video.encoder = EncoderType::Av1Nvenc;
    preset.video.rate_control = RateControlMode::Constqp;
    preset.video.quality_value = 18;
    preset.video.preset = "p7".to_string();
    preset.video.tune = Some("hq".to_string());
    preset.video.pix_fmt = Some("p010le".to_string());
    preset.video.b_ref_mode = Some("each".to_string());
    preset.video.rc_lookahead = Some(32);
    preset.video.spatial_aq = Some(true);
    preset.video.temporal_aq = Some(true);
    preset.audio.codec = AudioCodecType::Aac;
    preset.audio.bitrate = Some(320);
    preset.audio.loudness_profile = Some("ebuR128".to_string());
    preset.audio.true_peak_db = Some(-1.0);

    let input = PathBuf::from("C:/Videos/input.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");
    let joined = build_ffmpeg_args(&preset, &input, &output, true).join(" ");

    assert!(
        joined.contains("-rc constqp") && joined.contains("-qp 18"),
        "constqp mode must emit -rc constqp and -qp, got: {joined}"
    );
    assert!(
        joined.contains("-b_ref_mode each")
            && joined.contains("-rc-lookahead 32")
            && joined.contains("-spatial-aq 1")
            && joined.contains("-temporal-aq 1"),
        "NVENC quality flags should be emitted, got: {joined}"
    );
    assert!(
        joined.contains("-c:a aac") && joined.contains("-b:a 320k"),
        "AAC 320k audio flags should be emitted, got: {joined}"
    );
    assert!(
        joined.contains("loudnorm"),
        "Loudness profile should emit loudnorm filter, got: {joined}"
    );
}

// 其余与 ffmpeg 参数结构相关的测试保留在本文件中，契约测试已移动到
// ffmpeg_args_contract_tests.rs 以满足单文件 500 行限制。
