use std::path::Path;

use super::builder_tail::{
    apply_audio_args,
    apply_container_args,
    apply_filter_args,
    apply_hw_args,
    apply_subtitle_args,
};
use super::builder_webm::should_fallback_webm_forced_container;
use super::output_policy::{
    enforce_output_muxer_for_template,
    forced_muxer_for_policy,
};
use super::utils::ensure_progress_args;
use crate::ffui_core::domain::{
    DurationMode,
    EncoderType,
    FFmpegPreset,
    OutputContainerPolicy,
    OutputPolicy,
    OverwriteBehavior,
    RateControlMode,
    SeekMode,
};

/// 构建 ffmpeg 参数列表。
///
/// `non_interactive=true` 时自动注入 `-nostdin`，用于一次性非交互转码/扫描；
/// 需要支持“暂停 / 继续”的长跑任务应传 `false`，并由调用方确保不会触发
/// 交互式提问（例如总是显式指定 `-y`/`-n`），以免 ffmpeg 阻塞在 stdin。
pub(crate) fn build_ffmpeg_args(
    preset: &FFmpegPreset,
    input: &Path,
    output: &Path,
    non_interactive: bool,
    output_policy: Option<&OutputPolicy>,
) -> Vec<String> {
    let mut forced_muxer = forced_muxer_for_policy(output_policy, input);
    if forced_muxer.as_deref() == Some("webm")
        && let Some(policy) = output_policy
        && matches!(policy.container, OutputContainerPolicy::Force { .. })
        && should_fallback_webm_forced_container(preset, input)
    {
        forced_muxer = Some("matroska".to_string());
    }

    if preset.advanced_enabled.unwrap_or(false)
        && preset
            .ffmpeg_template
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        && let Some(template) = &preset.ffmpeg_template
    {
        let with_input = template.replace("INPUT", input.to_string_lossy().as_ref());
        let with_output = with_input.replace("OUTPUT", output.to_string_lossy().as_ref());
        let mut args: Vec<String> = with_output
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();
        ensure_progress_args(&mut args);
        if non_interactive && !args.iter().any(|a| a == "-nostdin") {
            args.push("-nostdin".to_string());
        }
        if let Some(fmt) = forced_muxer.as_deref() {
            enforce_output_muxer_for_template(&mut args, output, fmt);
        }
        return args;
    }

    let mut args: Vec<String> = Vec::new();
    ensure_progress_args(&mut args);
    if non_interactive && !args.iter().any(|a| a == "-nostdin") {
        args.push("-nostdin".to_string());
    }

    if let Some(global) = &preset.global {
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

    if let Some(timeline) = &preset.input
        && let Some(SeekMode::Input) = timeline.seek_mode
    {
        if let Some(pos) = &timeline.seek_position
            && !pos.is_empty()
        {
            args.push("-ss".to_string());
            args.push(pos.clone());
        }
        if timeline.accurate_seek.unwrap_or(false) {
            args.push("-accurate_seek".to_string());
        }
    }

    args.push("-i".to_string());
    args.push(input.to_string_lossy().into_owned());

    if let Some(timeline) = &preset.input {
        if let Some(SeekMode::Output) = timeline.seek_mode
            && let Some(pos) = &timeline.seek_position
            && !pos.is_empty()
        {
            args.push("-ss".to_string());
            args.push(pos.clone());
        }
        if let Some(duration) = &timeline.duration
            && !duration.is_empty()
        {
            match timeline.duration_mode {
                Some(DurationMode::Duration) => {
                    args.push("-t".to_string());
                    args.push(duration.clone());
                }
                Some(DurationMode::To) => {
                    args.push("-to".to_string());
                    args.push(duration.clone());
                }
                None => {}
            }
        }
        if timeline.accurate_seek.unwrap_or(false)
            && !matches!(timeline.seek_mode, Some(SeekMode::Input))
        {
            args.push("-accurate_seek".to_string());
        }
    }

    if let Some(mapping) = &preset.mapping {
        if let Some(maps) = &mapping.maps {
            for m in maps {
                if !m.is_empty() {
                    args.push("-map".to_string());
                    args.push(m.clone());
                }
            }
        }
        if let Some(dispositions) = &mapping.dispositions {
            for d in dispositions {
                if !d.is_empty() {
                    args.push("-disposition".to_string());
                    args.push(d.clone());
                }
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
    if !args.iter().any(|a| a == "-map") {
        args.push("-map".to_string());
        args.push("0".to_string());
    }

    match preset.video.encoder {
        EncoderType::Copy => {
            args.push("-c:v".to_string());
            args.push("copy".to_string());
        }
        ref enc => {
            args.push("-c:v".to_string());
            let enc_name = match enc {
                EncoderType::Libx264 => "libx264",
                EncoderType::Libx265 => "libx265",
                EncoderType::HevcNvenc => "hevc_nvenc",
                EncoderType::H264Nvenc => "h264_nvenc",
                EncoderType::Av1Nvenc => "av1_nvenc",
                EncoderType::HevcQsv => "hevc_qsv",
                EncoderType::Av1Qsv => "av1_qsv",
                EncoderType::HevcAmf => "hevc_amf",
                EncoderType::Av1Amf => "av1_amf",
                EncoderType::LibSvtAv1 => "libsvtav1",
                EncoderType::Copy => "copy",
            };
            args.push(enc_name.to_string());

            match preset.video.rate_control {
                RateControlMode::Crf => {
                    args.push("-crf".to_string());
                    args.push(preset.video.quality_value.to_string());
                }
                RateControlMode::Constqp => {
                    args.push("-rc".to_string());
                    args.push("constqp".to_string());
                    args.push("-qp".to_string());
                    args.push(preset.video.quality_value.to_string());
                }
                RateControlMode::Cq => {
                    if matches!(enc, EncoderType::HevcQsv | EncoderType::Av1Qsv) {
                        args.push("-global_quality".to_string());
                        args.push(preset.video.quality_value.to_string());
                    } else {
                        args.push("-cq".to_string());
                        args.push(preset.video.quality_value.to_string());
                    }
                }
                RateControlMode::Cbr | RateControlMode::Vbr => {
                    if let Some(bitrate) = preset.video.bitrate_kbps {
                        args.push("-b:v".to_string());
                        args.push(format!("{bitrate}k"));
                    }
                    if let Some(maxrate) = preset.video.max_bitrate_kbps {
                        args.push("-maxrate".to_string());
                        args.push(format!("{maxrate}k"));
                    }
                    if let Some(bufsize) = preset.video.buffer_size_kbits {
                        args.push("-bufsize".to_string());
                        args.push(format!("{bufsize}k"));
                    }
                    if let Some(pass) = preset.video.pass
                        && (pass == 1 || pass == 2)
                    {
                        args.push("-pass".to_string());
                        args.push(pass.to_string());
                    }
                }
            }

            if !preset.video.preset.is_empty() {
                args.push("-preset".to_string());
                args.push(preset.video.preset.clone());
            }
            if let Some(tune) = &preset.video.tune
                && !tune.is_empty()
            {
                args.push("-tune".to_string());
                args.push(tune.clone());
            }
            if let Some(profile) = &preset.video.profile
                && !profile.is_empty()
            {
                args.push("-profile:v".to_string());
                args.push(profile.clone());
            }
            if let Some(level) = &preset.video.level
                && !level.is_empty()
            {
                args.push("-level".to_string());
                args.push(level.clone());
            }
            if let Some(gop) = preset.video.gop_size
                && gop > 0
            {
                args.push("-g".to_string());
                args.push(gop.to_string());
            }
            if let Some(bf) = preset.video.bf {
                args.push("-bf".to_string());
                args.push(bf.to_string());
            }
            if let Some(pix_fmt) = &preset.video.pix_fmt
                && !pix_fmt.is_empty()
            {
                args.push("-pix_fmt".to_string());
                args.push(pix_fmt.clone());
            }
            if let Some(mode) = &preset.video.b_ref_mode
                && !mode.is_empty()
            {
                args.push("-b_ref_mode".to_string());
                args.push(mode.clone());
            }
            if let Some(lookahead) = preset.video.rc_lookahead
                && lookahead > 0
            {
                args.push("-rc-lookahead".to_string());
                args.push(lookahead.to_string());
            }
            if let Some(true) = preset.video.spatial_aq {
                args.push("-spatial-aq".to_string());
                args.push("1".to_string());
            }
            if let Some(true) = preset.video.temporal_aq {
                args.push("-temporal-aq".to_string());
                args.push("1".to_string());
            }
        }
    }

    apply_audio_args(&mut args, preset);
    apply_filter_args(&mut args, preset);
    apply_subtitle_args(&mut args, preset);

    apply_container_args(&mut args, preset, forced_muxer.as_deref());
    apply_hw_args(&mut args, preset);

    args.push(output.to_string_lossy().into_owned());
    args
}
