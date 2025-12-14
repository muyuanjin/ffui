use super::*;

#[test]
fn build_ffmpeg_args_skips_audio_filters_when_codec_is_copy() {
    let mut preset = make_test_preset();
    // Audio codec defaults to Copy in make_test_preset; ensure an af_chain is configured.
    preset.filters.af_chain = Some("acompressor=threshold=-18dB".to_string());

    let input = PathBuf::from("C:/Videos/input.mp4");
    let output = PathBuf::from("C:/Videos/output.tmp.mp4");
    let joined = build_ffmpeg_args(&preset, &input, &output, true, None).join(" ");

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
    let joined = build_ffmpeg_args(&preset, &input, &output, true, None).join(" ");

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
