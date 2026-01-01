use super::normalize_container_format;
use crate::ffui_core::domain::{
    AudioCodecType, EncoderType, FFmpegPreset, OverwriteBehavior, SubtitleStrategy,
};

pub(in crate::ffui_core::engine) fn apply_global_args(
    args: &mut Vec<String>,
    preset: &FFmpegPreset,
) {
    let Some(global) = preset.global.as_ref() else {
        return;
    };

    if let Some(behavior) = &global.overwrite_behavior {
        match behavior {
            OverwriteBehavior::Overwrite => {
                args.push("-y".to_string());
            }
            OverwriteBehavior::NoOverwrite => {
                args.push("-n".to_string());
            }
            OverwriteBehavior::Ask => {
                // Use ffmpeg default behaviour; emit no flag.
            }
        }
    }
    if let Some(level) = &global.log_level
        && !level.is_empty()
    {
        args.push("-loglevel".to_string());
        args.push(level.clone());
    }
    if global.hide_banner.unwrap_or(false) {
        args.push("-hide_banner".to_string());
    }
    if global.enable_report.unwrap_or(false) {
        args.push("-report".to_string());
    }
}

pub(in crate::ffui_core::engine) fn apply_audio_args(
    args: &mut Vec<String>,
    preset: &FFmpegPreset,
) {
    match preset.audio.codec {
        AudioCodecType::Copy => {
            args.push("-c:a".to_string());
            args.push("copy".to_string());
        }
        AudioCodecType::Aac => {
            args.push("-c:a".to_string());
            args.push("aac".to_string());
            if let Some(bitrate) = preset.audio.bitrate {
                args.push("-b:a".to_string());
                args.push(format!("{bitrate}k"));
            }
            if let Some(sample_rate) = preset.audio.sample_rate_hz {
                args.push("-ar".to_string());
                args.push(sample_rate.to_string());
            }
            if let Some(channels) = preset.audio.channels {
                args.push("-ac".to_string());
                args.push(channels.to_string());
            }
            if let Some(layout) = &preset.audio.channel_layout
                && !layout.is_empty()
            {
                args.push("-channel_layout".to_string());
                args.push(layout.clone());
            }
        }
    }
}

pub(super) fn apply_filter_args(args: &mut Vec<String>, preset: &FFmpegPreset) {
    let can_apply_video_filters = !matches!(preset.video.encoder, EncoderType::Copy);
    let can_apply_audio_filters = !matches!(preset.audio.codec, AudioCodecType::Copy);

    let mut vf_parts: Vec<String> = Vec::new();
    if can_apply_video_filters {
        if let Some(scale) = &preset.filters.scale
            && !scale.is_empty()
        {
            vf_parts.push(format!("scale={scale}"));
        }
        if let Some(crop) = &preset.filters.crop
            && !crop.is_empty()
        {
            vf_parts.push(format!("crop={crop}"));
        }
        if let Some(fps) = preset.filters.fps
            && fps > 0
        {
            vf_parts.push(format!("fps={fps}"));
        }
        if let Some(subtitles) = &preset.subtitles
            && matches!(subtitles.strategy, Some(SubtitleStrategy::BurnIn))
            && let Some(filter) = &subtitles.burn_in_filter
            && !filter.is_empty()
        {
            vf_parts.push(filter.clone());
        }
    }
    let vf_chain = preset
        .filters
        .vf_chain
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    if can_apply_video_filters && (!vf_parts.is_empty() || vf_chain.is_some()) {
        let mut combined = String::new();
        if !vf_parts.is_empty() {
            combined.push_str(&vf_parts.join(","));
        }
        if let Some(chain) = vf_chain.map(std::string::ToString::to_string) {
            if !combined.is_empty() {
                combined.push(',');
            }
            combined.push_str(&chain);
        }
        args.push("-vf".to_string());
        args.push(combined);
    }

    if can_apply_audio_filters {
        apply_audio_filter_args(args, preset);
    }

    if can_apply_video_filters && let Some(filter_complex) = &preset.filters.filter_complex {
        let trimmed = filter_complex.trim();
        if !trimmed.is_empty() {
            args.push("-filter_complex".to_string());
            args.push(trimmed.to_string());
        }
    }
}

pub(in crate::ffui_core::engine) fn apply_audio_filter_args(
    args: &mut Vec<String>,
    preset: &FFmpegPreset,
) {
    if matches!(preset.audio.codec, AudioCodecType::Copy) {
        return;
    }

    let mut af_parts: Vec<String> = Vec::new();
    if let Some(ref profile) = preset.audio.loudness_profile
        && profile != "none"
    {
        let default_i = preset
            .audio
            .target_lufs
            .unwrap_or(if profile == "cnBroadcast" {
                -24.0
            } else {
                -23.0
            });
        let default_lra = preset.audio.loudness_range.unwrap_or(7.0);
        let default_tp = preset
            .audio
            .true_peak_db
            .unwrap_or(if profile == "cnBroadcast" { -2.0 } else { -1.0 });

        let safe_i = default_i.clamp(-36.0, -10.0);
        let safe_lra = default_lra.clamp(1.0, 20.0);
        let safe_tp = default_tp.min(-0.1);

        let loudnorm_expr =
            format!("loudnorm=I={safe_i}:LRA={safe_lra}:TP={safe_tp}:print_format=summary");
        af_parts.push(loudnorm_expr);
    }

    if let Some(af_chain) = &preset.filters.af_chain {
        let trimmed = af_chain.trim();
        if !trimmed.is_empty() {
            af_parts.push(trimmed.to_string());
        }
    }

    if !af_parts.is_empty() {
        args.push("-af".to_string());
        args.push(af_parts.join(","));
    }
}

pub(in crate::ffui_core::engine) fn apply_mapping_disposition_and_metadata_args(
    args: &mut Vec<String>,
    preset: &FFmpegPreset,
) {
    if let Some(mapping) = preset.mapping.as_ref() {
        if let Some(index) = mapping.map_metadata_from_input_file_index {
            args.push("-map_metadata".to_string());
            args.push(index.to_string());
        }
        if let Some(index) = mapping.map_chapters_from_input_file_index {
            args.push("-map_chapters".to_string());
            args.push(index.to_string());
        }
        if let Some(dispositions) = &mapping.dispositions {
            for d in dispositions {
                let trimmed = d.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 2 {
                    let raw_spec = parts[0].trim();
                    let value = parts[1..].join(" ");
                    let spec = if raw_spec.chars().next().is_some_and(|c| c.is_ascii_digit())
                        && raw_spec.split_once(':').is_some_and(|(_, rest)| {
                            matches!(rest.chars().next(), Some('v' | 'a' | 's' | 'd'))
                        }) {
                        raw_spec
                            .split_once(':')
                            .map(|(_, rest)| rest)
                            .unwrap_or(raw_spec)
                    } else {
                        raw_spec
                    };
                    if !spec.is_empty() && !value.is_empty() {
                        args.push(format!("-disposition:{spec}"));
                        args.push(value);
                        continue;
                    }
                }

                args.push("-disposition".to_string());
                args.push(trimmed.to_string());
            }
        }
        if let Some(metadata) = &mapping.metadata {
            for kv in metadata {
                if !kv.is_empty() {
                    args.push("-metadata".to_string());
                    args.push(kv.clone());
                }
            }
        }
    }
}

pub(super) fn apply_subtitle_args(args: &mut Vec<String>, preset: &FFmpegPreset) {
    if let Some(subtitles) = &preset.subtitles
        && matches!(subtitles.strategy, Some(SubtitleStrategy::Drop))
    {
        args.push("-sn".to_string());
    }
}

pub(in crate::ffui_core::engine) fn apply_container_args(
    args: &mut Vec<String>,
    preset: &FFmpegPreset,
    forced_muxer: Option<&str>,
) {
    if let Some(container) = &preset.container {
        let muxer = forced_muxer
            .map(std::string::ToString::to_string)
            .or_else(|| {
                container
                    .format
                    .as_deref()
                    .map(std::string::ToString::to_string)
            });
        if let Some(format) = muxer
            && !format.trim().is_empty()
        {
            args.push("-f".to_string());
            let normalized = normalize_container_format(&format);
            if !normalized.is_empty() {
                args.push(normalized);
            }
        }
        if let Some(flags) = &container.movflags {
            let joined: String = flags
                .iter()
                .map(|f| f.trim())
                .filter(|f| !f.is_empty())
                .collect::<Vec<_>>()
                .join("+");
            if !joined.is_empty() {
                args.push("-movflags".to_string());
                args.push(joined);
            }
        }
    } else if let Some(format) = forced_muxer {
        // Presets without an explicit container group still need to honor a
        // forced output container policy.
        args.push("-f".to_string());
        let normalized = normalize_container_format(format);
        if !normalized.is_empty() {
            args.push(normalized);
        }
    }
}

pub(super) fn apply_hw_args(args: &mut Vec<String>, preset: &FFmpegPreset) {
    if let Some(hw) = &preset.hardware {
        if let Some(accel) = &hw.hwaccel {
            let trimmed = accel.trim();
            if !trimmed.is_empty() {
                args.push("-hwaccel".to_string());
                args.push(trimmed.to_string());
            }
        }
        if let Some(device) = &hw.hwaccel_device {
            let trimmed = device.trim();
            if !trimmed.is_empty() {
                args.push("-hwaccel_device".to_string());
                args.push(trimmed.to_string());
            }
        }
        if let Some(fmt) = &hw.hwaccel_output_format {
            let trimmed = fmt.trim();
            if !trimmed.is_empty() {
                args.push("-hwaccel_output_format".to_string());
                args.push(trimmed.to_string());
            }
        }
        if let Some(bsfs) = &hw.bitstream_filters {
            for bsf in bsfs {
                let trimmed = bsf.trim();
                if !trimmed.is_empty() {
                    args.push("-bsf".to_string());
                    args.push(trimmed.to_string());
                }
            }
        }
    }
}
