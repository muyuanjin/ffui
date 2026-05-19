use once_cell::sync::Lazy;
use regex::Regex;

use super::{EncoderType, FFmpegPreset};

static INPUT_PLACEHOLDER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\bINPUT\b").expect("valid INPUT regex"));
static OUTPUT_PLACEHOLDER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\bOUTPUT\b").expect("valid OUTPUT regex"));

pub fn validate_preset_for_save(preset: &FFmpegPreset) -> Result<(), String> {
    if let Some(fps) = preset.filters.fps
        && (!fps.is_finite() || fps <= 0.0)
    {
        return Err(format!(
            "filters.fps must be a finite positive number, got {fps}"
        ));
    }

    validate_quality_range(preset)?;
    validate_bitrate_bounds(preset)?;
    validate_template_placeholders(preset)?;

    Ok(())
}

fn validate_quality_range(preset: &FFmpegPreset) -> Result<(), String> {
    let Some((min, max)) = quality_range_for_encoder(&preset.video.encoder) else {
        return Ok(());
    };
    let value = preset.video.quality_value;
    if value < min || value > max {
        return Err(format!(
            "video.qualityValue {value} is outside the range {min}..={max} for encoder {}",
            preset.video.encoder.as_str()
        ));
    }
    Ok(())
}

fn quality_range_for_encoder(encoder: &EncoderType) -> Option<(i32, i32)> {
    match encoder {
        EncoderType::Copy => Some((0, 0)),
        EncoderType::LibSvtAv1 => Some((0, 63)),
        EncoderType::Unknown(_) => None,
        _ => Some((0, 51)),
    }
}

fn validate_bitrate_bounds(preset: &FFmpegPreset) -> Result<(), String> {
    let video = &preset.video;
    for (field, value) in [
        ("video.bitrateKbps", video.bitrate_kbps),
        ("video.maxBitrateKbps", video.max_bitrate_kbps),
        ("video.bufferSizeKbits", video.buffer_size_kbits),
    ] {
        if value.is_some_and(|v| v <= 0) {
            return Err(format!("{field} must be positive when set"));
        }
    }

    if let (Some(bitrate), Some(maxrate)) = (video.bitrate_kbps, video.max_bitrate_kbps)
        && maxrate < bitrate
    {
        return Err(format!(
            "video.maxBitrateKbps ({maxrate}) must be >= video.bitrateKbps ({bitrate})"
        ));
    }
    Ok(())
}

fn validate_template_placeholders(preset: &FFmpegPreset) -> Result<(), String> {
    if !preset.advanced_enabled.unwrap_or(false) {
        return Ok(());
    }
    let template = preset
        .ffmpeg_template
        .as_deref()
        .map(str::trim)
        .unwrap_or("");
    if template.is_empty() {
        return Err("ffmpegTemplate is required when advancedEnabled is true".to_string());
    }
    let input_count = INPUT_PLACEHOLDER.find_iter(template).count();
    let output_count = OUTPUT_PLACEHOLDER.find_iter(template).count();
    if input_count != 1 || output_count != 1 {
        return Err(format!(
            "ffmpegTemplate must contain exactly one INPUT and one OUTPUT placeholder, got INPUT={input_count}, OUTPUT={output_count}"
        ));
    }
    Ok(())
}
