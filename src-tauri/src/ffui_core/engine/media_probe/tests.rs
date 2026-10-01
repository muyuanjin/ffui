use super::*;

#[test]
fn audio_queue_contract_separates_cover_art_from_temporal_video() {
    let contract: Value =
        serde_json::from_str(include_str!("../../../../tests/audio-queue-contract.json"))
            .expect("contract");
    let media = parse_media(&contract["probe"]).expect("audio");
    assert_eq!(
        serde_json::to_value(&media.info).expect("wire"),
        contract["mediaInfo"]
    );
    assert_eq!(media.audio_duration, Some(120.0));
    assert_eq!(media.cover_stream, Some(1));
    let mut video = contract["probe"].clone();
    video["streams"][1]["disposition"]["attached_pic"] = 0.into();
    assert!(parse_media(&video).is_none());
    let mut multiple = contract["probe"].clone();
    let second = multiple["streams"][0].clone();
    multiple["streams"]
        .as_array_mut()
        .expect("streams")
        .push(second);
    assert!(
        parse_media(&multiple)
            .expect("audio")
            .audio_duration
            .is_none()
    );
}

#[test]
fn audio_probe_without_duration_or_cover_retains_metadata_without_progress() {
    let media = parse_media(&serde_json::json!({"streams": [{"codec_type": "audio", "codec_name": "flac", "sample_rate": "48000", "channels": 1}], "format": {"duration": "N/A"}})).expect("audio");
    assert!(media.audio_duration.is_none());
    assert!(media.cover_stream.is_none());
    assert_eq!(media.info.audio_codec.as_deref(), Some("flac"));
    assert_eq!(
        media.info.audio.expect("metadata").sample_rate_hz,
        Some(48000)
    );
}

#[test]
fn offset_origins_do_not_turn_timestamp_endpoints_into_audio_spans() {
    for duration in ["124.006500", "4.002902"] {
        let media = parse_media(&serde_json::json!({
            "streams": [{"codec_type": "audio", "start_time": "120", "duration": duration}],
            "format": {"format_name": "ogg", "start_time": "120", "duration": duration}
        }))
        .expect("audio metadata");
        assert!(media.info.duration_seconds.is_none());
        assert!(media.audio_duration.is_none());
    }
    let media = parse_media(&serde_json::json!({
        "streams": [{"codec_type": "audio", "start_time": "0.025057", "duration": "4.048980"}],
        "format": {"format_name": "mp3", "start_time": "0.025057", "duration": "4.048980"}
    }))
    .expect("mp3");
    assert_eq!(media.info.duration_seconds, Some(4.048980));
    assert_eq!(media.audio_duration, Some(4.048980));
}
