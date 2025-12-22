use chrono::Local;
use regex::Regex;

use super::utils::random_hex;
use crate::ffui_core::domain::{
    EncoderType,
    FFmpegPreset,
    OutputFilenameAppend,
    OutputPolicy,
    RateControlMode,
};

pub(super) fn apply_filename_policy(
    base_stem: &str,
    preset: Option<&FFmpegPreset>,
    policy: &OutputPolicy,
) -> String {
    let mut stem = base_stem.to_string();

    if let Some(repl) = policy.filename.regex_replace.as_ref()
        && !repl.pattern.trim().is_empty()
        && let Ok(re) = Regex::new(&repl.pattern)
    {
        stem = re.replace_all(&stem, repl.replacement.as_str()).to_string();
    }

    if let Some(prefix) = policy.filename.prefix.as_ref()
        && !prefix.is_empty()
    {
        stem = format!("{prefix}{stem}");
    }

    for item in normalized_append_order(policy) {
        match item {
            OutputFilenameAppend::Suffix => {
                if let Some(suffix) = policy.filename.suffix.as_ref()
                    && !suffix.is_empty()
                {
                    stem = format!("{stem}{suffix}");
                }
            }
            OutputFilenameAppend::Timestamp => {
                if policy.filename.append_timestamp {
                    let ts = Local::now().format("%Y%m%d-%H%M%S").to_string();
                    stem = format!("{stem}-{ts}");
                }
            }
            OutputFilenameAppend::EncoderQuality => {
                if policy.filename.append_encoder_quality
                    && let Some(tag) = infer_encoder_quality_tag(preset)
                {
                    stem = format!("{stem}-{tag}");
                }
            }
            OutputFilenameAppend::Random => {
                if let Some(len) = policy.filename.random_suffix_len
                    && len > 0
                {
                    let token = random_hex(len as usize);
                    stem = format!("{stem}-{token}");
                }
            }
        }
    }

    stem
}

fn normalized_append_order(policy: &OutputPolicy) -> Vec<OutputFilenameAppend> {
    let mut seen = std::collections::HashSet::<OutputFilenameAppend>::new();
    let mut out: Vec<OutputFilenameAppend> = Vec::new();
    for item in policy.filename.append_order.iter().copied() {
        if seen.insert(item) {
            out.push(item);
        }
    }
    for item in [
        OutputFilenameAppend::Suffix,
        OutputFilenameAppend::Timestamp,
        OutputFilenameAppend::EncoderQuality,
        OutputFilenameAppend::Random,
    ] {
        if seen.insert(item) {
            out.push(item);
        }
    }
    out
}

fn infer_encoder_quality_tag(preset: Option<&FFmpegPreset>) -> Option<String> {
    let preset = preset?;

    // Prefer structured model when present.
    if !preset.advanced_enabled.unwrap_or(false) {
        let enc = match preset.video.encoder {
            EncoderType::Libx264 => "x264",
            EncoderType::Libx265 => "x265",
            EncoderType::HevcNvenc => "hevc_nvenc",
            EncoderType::H264Nvenc => "h264_nvenc",
            EncoderType::Av1Nvenc => "av1_nvenc",
            EncoderType::HevcQsv => "hevc_qsv",
            EncoderType::Av1Qsv => "av1_qsv",
            EncoderType::HevcAmf => "hevc_amf",
            EncoderType::Av1Amf => "av1_amf",
            EncoderType::LibSvtAv1 => "svtav1",
            EncoderType::Copy => "copy",
        };

        let q = preset.video.quality_value;
        let qtag = match preset.video.rate_control {
            RateControlMode::Crf => format!("crf{q}"),
            RateControlMode::Cq => format!("cq{q}"),
            RateControlMode::Constqp => format!("qp{q}"),
            RateControlMode::Cbr => preset
                .video
                .bitrate_kbps
                .map(|b| format!("cbr{b}k"))
                .unwrap_or_else(|| "cbr".to_string()),
            RateControlMode::Vbr => {
                let avg = preset.video.bitrate_kbps;
                let max = preset.video.max_bitrate_kbps;
                match (avg, max) {
                    (Some(avg), Some(max)) => format!("vbr{avg}k-max{max}k"),
                    (Some(avg), None) => format!("vbr{avg}k"),
                    (None, Some(max)) => format!("vbr-max{max}k"),
                    (None, None) => "vbr".to_string(),
                }
            }
        };
        return Some(format!("{enc}-{qtag}"));
    }

    // Best-effort parse from template for advanced presets.
    let template = preset.ffmpeg_template.as_ref()?.trim();
    if template.is_empty() {
        return None;
    }
    let mut tokens = crate::ffui_core::engine::template_args::split_template_args(template);
    crate::ffui_core::engine::template_args::strip_leading_ffmpeg_program(&mut tokens);
    let mut codec: Option<String> = None;
    let mut quality: Option<String> = None;
    let mut i = 0usize;
    while i + 1 < tokens.len() {
        match tokens[i].as_str() {
            "-c:v" => {
                codec = Some(tokens[i + 1].clone());
                i += 2;
            }
            "-crf" => {
                quality = Some(format!("crf{}", tokens[i + 1]));
                i += 2;
            }
            "-cq" => {
                quality = Some(format!("cq{}", tokens[i + 1]));
                i += 2;
            }
            "-qp" => {
                quality = Some(format!("qp{}", tokens[i + 1]));
                i += 2;
            }
            "-global_quality" => {
                quality = Some(format!("q{}", tokens[i + 1]));
                i += 2;
            }
            _ => i += 1,
        }
    }
    match (codec, quality) {
        (Some(c), Some(q)) => Some(format!("{c}-{q}")),
        (Some(c), None) => Some(c),
        _ => None,
    }
}

pub(super) fn sanitize_windows_path_segment(input: &str) -> String {
    let mut s = input
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) <= 31 => '_',
            _ => ch,
        })
        .collect::<String>();

    while s.ends_with(' ') || s.ends_with('.') {
        s.pop();
    }

    let upper = s.to_ascii_uppercase();
    let base = upper.split('.').next().unwrap_or("");
    let reserved = matches!(
        base,
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if reserved && !s.is_empty() {
        s.insert(0, '_');
    }

    s
}
