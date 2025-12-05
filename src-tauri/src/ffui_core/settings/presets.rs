use anyhow::Result;

use crate::ffui_core::domain::{
    AudioCodecType, AudioConfig, EncoderType, FFmpegPreset, FilterConfig, PresetStats,
    RateControlMode, VideoConfig,
};

use super::io::{executable_sidecar_path, read_json_file, write_json_file};

/// INITIAL_PRESETS in src/MainApp.vue (ids p1 / p2).
pub(super) fn default_presets() -> Vec<FFmpegPreset> {
    vec![
        FFmpegPreset {
            id: "p1".to_string(),
            name: "Universal 1080p".to_string(),
            description: "x264 Medium CRF 23. Standard for web.".to_string(),
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
                scale: Some("-2:1080".to_string()),
                crop: None,
                fps: None,
                vf_chain: None,
                af_chain: None,
                filter_complex: None,
            },
            subtitles: None,
            container: None,
            hardware: None,
            stats: PresetStats {
                usage_count: 5,
                total_input_size_mb: 2500.0,
                total_output_size_mb: 800.0,
                total_time_seconds: 420.0,
            },
            advanced_enabled: Some(false),
            ffmpeg_template: None,
        },
        FFmpegPreset {
            id: "p2".to_string(),
            name: "Archive Master".to_string(),
            description: "x264 Slow CRF 18. Near lossless.".to_string(),
            global: None,
            input: None,
            mapping: None,
            video: VideoConfig {
                encoder: EncoderType::Libx264,
                rate_control: RateControlMode::Crf,
                quality_value: 18,
                preset: "slow".to_string(),
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
            subtitles: None,
            container: None,
            hardware: None,
            stats: PresetStats {
                usage_count: 2,
                total_input_size_mb: 5000.0,
                total_output_size_mb: 3500.0,
                total_time_seconds: 1200.0,
            },
            advanced_enabled: Some(false),
            ffmpeg_template: None,
        },
    ]
}

pub fn load_presets() -> Result<Vec<FFmpegPreset>> {
    let path = executable_sidecar_path("presets.json")?;
    // When there is no presets.json yet (fresh install), or when the file is
    // unreadable/empty, fall back to the built-in defaults so well-known
    // presets like "Universal 1080p" (id p1) are always present for the
    // transcoding engine.
    let mut presets = if !path.exists() {
        default_presets()
    } else {
        match read_json_file(&path) {
            Ok(existing) => existing,
            Err(err) => {
                eprintln!("failed to load presets from {}: {err:#}", path.display());
                default_presets()
            }
        }
    };

    // Ensure all built-in defaults exist at least once. This protects against
    // older installs that may have an empty or partial presets.json on disk.
    for builtin in default_presets() {
        if !presets.iter().any(|p| p.id == builtin.id) {
            presets.push(builtin);
        }
    }

    Ok(presets)
}

pub fn save_presets(presets: &[FFmpegPreset]) -> Result<()> {
    let path = executable_sidecar_path("presets.json")?;
    write_json_file(&path, presets)
}
