use crate::ffui_core::domain::{
    AudioCodecType, AudioConfig, EncoderType, FFmpegPreset, FilterConfig, PresetStats,
    RateControlMode, VideoConfig,
};

pub(super) const fn empty_stats() -> PresetStats {
    PresetStats {
        usage_count: 0,
        total_input_size_mb: 0.0,
        total_output_size_mb: 0.0,
        total_time_seconds: 0.0,
        total_frames: 0.0,
        vmaf_count: 0,
        vmaf_sum: 0.0,
        vmaf_min: 0.0,
        vmaf_max: 0.0,
    }
}

pub(super) const fn audio_copy() -> AudioConfig {
    AudioConfig {
        codec: AudioCodecType::Copy,
        bitrate: None,
        sample_rate_hz: None,
        channels: None,
        channel_layout: None,
        loudness_profile: None,
        target_lufs: None,
        loudness_range: None,
        true_peak_db: None,
    }
}

pub(super) const fn filters_empty() -> FilterConfig {
    FilterConfig {
        scale: None,
        crop: None,
        fps: None,
        vf_chain: None,
        af_chain: None,
        filter_complex: None,
    }
}

pub(super) fn filters_scale(scale: &str) -> FilterConfig {
    FilterConfig {
        scale: Some(scale.to_string()),
        ..filters_empty()
    }
}

pub(super) fn video_x264_crf(
    quality_value: i32,
    preset: &str,
    pix_fmt: Option<&str>,
) -> VideoConfig {
    VideoConfig {
        encoder: EncoderType::Libx264,
        rate_control: RateControlMode::Crf,
        quality_value,
        preset: preset.to_string(),
        tune: None,
        profile: None,
        bitrate_kbps: None,
        max_bitrate_kbps: None,
        buffer_size_kbits: None,
        pass: None,
        level: None,
        gop_size: None,
        bf: None,
        pix_fmt: pix_fmt.map(std::string::ToString::to_string),
        b_ref_mode: None,
        rc_lookahead: None,
        spatial_aq: None,
        temporal_aq: None,
    }
}

pub(super) fn video_svtav1_crf(
    quality_value: i32,
    preset: &str,
    pix_fmt: Option<&str>,
    gop_size: Option<u32>,
    bf: Option<u32>,
) -> VideoConfig {
    VideoConfig {
        encoder: EncoderType::LibSvtAv1,
        rate_control: RateControlMode::Crf,
        quality_value,
        preset: preset.to_string(),
        tune: None,
        profile: None,
        bitrate_kbps: None,
        max_bitrate_kbps: None,
        buffer_size_kbits: None,
        pass: None,
        level: None,
        gop_size,
        bf,
        pix_fmt: pix_fmt.map(std::string::ToString::to_string),
        b_ref_mode: None,
        rc_lookahead: None,
        spatial_aq: None,
        temporal_aq: None,
    }
}

pub(super) fn base_preset(
    id: &str,
    name: &str,
    description: &str,
    video: VideoConfig,
    filters: FilterConfig,
    is_smart_preset: Option<bool>,
) -> FFmpegPreset {
    FFmpegPreset {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        created_time_ms: None,
        description_i18n: None,
        global: None,
        input: None,
        mapping: None,
        video,
        audio: audio_copy(),
        filters,
        subtitles: None,
        container: None,
        hardware: None,
        stats: empty_stats(),
        advanced_enabled: Some(false),
        ffmpeg_template: None,
        is_smart_preset,
    }
}
