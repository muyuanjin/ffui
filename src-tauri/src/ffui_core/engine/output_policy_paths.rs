use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::Local;
use regex::Regex;

use crate::ffui_core::domain::{
    EncoderType, FFmpegPreset, OutputContainerPolicy, OutputDirectoryPolicy, OutputFilenameAppend,
    OutputPolicy, RateControlMode,
};

use super::ffmpeg_args::{
    infer_output_extension, normalize_container_format as normalize_muxer_format,
};

static RANDOM_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OutputPathPlan {
    pub(crate) output_path: PathBuf,
    pub(crate) forced_muxer: Option<String>,
}

pub(crate) fn plan_video_output_path(
    input: &Path,
    preset: Option<&FFmpegPreset>,
    policy: &OutputPolicy,
    mut is_reserved: impl FnMut(&Path) -> bool,
) -> OutputPathPlan {
    let input_parent = input.parent().unwrap_or_else(|| Path::new("."));
    let input_stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");

    let target_dir = match &policy.directory {
        OutputDirectoryPolicy::SameAsInput => input_parent.to_path_buf(),
        OutputDirectoryPolicy::Fixed { directory } => {
            let trimmed = directory.trim();
            if trimmed.is_empty() {
                input_parent.to_path_buf()
            } else {
                PathBuf::from(trimmed)
            }
        }
    };

    let input_ext = input.extension().and_then(|e| e.to_str());

    let (ext, forced_muxer) = infer_container_extension_and_muxer(input_ext, preset, policy);

    let mut stem = apply_filename_policy(input_stem, preset, policy);
    stem = sanitize_windows_path_segment(&stem);
    if stem.is_empty() {
        stem = "output".to_string();
    }

    let mut candidate = target_dir.join(format!("{stem}.{ext}"));

    if candidate == input {
        candidate = target_dir.join(format!("{stem} (1).{ext}"));
    }

    let mut counter: u32 = 0;
    while candidate == input || candidate.exists() || is_reserved(&candidate) {
        counter += 1;
        candidate = target_dir.join(format!("{stem} ({counter}).{ext}"));
        // Worst-case escape hatch: if the stem is pathological and collisions keep happening,
        // inject a short random token to break ties deterministically.
        if counter >= 1000 {
            let token = random_hex(8);
            candidate = target_dir.join(format!("{stem}-{token}.{ext}"));
            break;
        }
    }

    OutputPathPlan {
        output_path: candidate,
        forced_muxer,
    }
}

pub(crate) fn preview_video_output_path(
    input: &Path,
    preset: Option<&FFmpegPreset>,
    policy: &OutputPolicy,
) -> OutputPathPlan {
    let input_parent = input.parent().unwrap_or_else(|| Path::new("."));
    let input_stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");

    let target_dir = match &policy.directory {
        OutputDirectoryPolicy::SameAsInput => input_parent.to_path_buf(),
        OutputDirectoryPolicy::Fixed { directory } => {
            let trimmed = directory.trim();
            if trimmed.is_empty() {
                input_parent.to_path_buf()
            } else {
                PathBuf::from(trimmed)
            }
        }
    };

    let input_ext = input.extension().and_then(|e| e.to_str());
    let (ext, forced_muxer) = infer_container_extension_and_muxer(input_ext, preset, policy);

    let mut stem = apply_filename_policy(input_stem, preset, policy);
    stem = sanitize_windows_path_segment(&stem);
    if stem.is_empty() {
        stem = "output".to_string();
    }

    let mut candidate = target_dir.join(format!("{stem}.{ext}"));
    if candidate == input {
        candidate = target_dir.join(format!("{stem} (1).{ext}"));
    }

    OutputPathPlan {
        output_path: candidate,
        forced_muxer,
    }
}

pub(crate) fn plan_output_path_with_extension(
    input: &Path,
    extension_no_dot: &str,
    preset: Option<&FFmpegPreset>,
    policy: &OutputPolicy,
    mut is_reserved: impl FnMut(&Path) -> bool,
) -> PathBuf {
    let input_parent = input.parent().unwrap_or_else(|| Path::new("."));
    let input_stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");

    let target_dir = match &policy.directory {
        OutputDirectoryPolicy::SameAsInput => input_parent.to_path_buf(),
        OutputDirectoryPolicy::Fixed { directory } => {
            let trimmed = directory.trim();
            if trimmed.is_empty() {
                input_parent.to_path_buf()
            } else {
                PathBuf::from(trimmed)
            }
        }
    };

    let mut stem = apply_filename_policy(input_stem, preset, policy);
    stem = sanitize_windows_path_segment(&stem);
    if stem.is_empty() {
        stem = "output".to_string();
    }

    let ext = normalize_extension_no_dot(extension_no_dot);
    let mut candidate = target_dir.join(format!("{stem}.{ext}"));

    if candidate == input {
        candidate = target_dir.join(format!("{stem} (1).{ext}"));
    }

    let mut counter: u32 = 0;
    while candidate == input || candidate.exists() || is_reserved(&candidate) {
        counter += 1;
        candidate = target_dir.join(format!("{stem} ({counter}).{ext}"));
        if counter >= 1000 {
            let token = random_hex(8);
            candidate = target_dir.join(format!("{stem}-{token}.{ext}"));
            break;
        }
    }

    candidate
}

fn infer_container_extension_and_muxer(
    input_ext: Option<&str>,
    preset: Option<&FFmpegPreset>,
    policy: &OutputPolicy,
) -> (String, Option<String>) {
    match &policy.container {
        OutputContainerPolicy::Force { format } => {
            let raw = format.trim().trim_start_matches('.');
            let muxer = normalize_muxer_format(raw);
            if muxer.is_empty() {
                let ext = infer_output_extension(None, input_ext);
                (ext, None)
            } else {
                let ext = infer_output_extension(Some(muxer.as_str()), input_ext);
                (ext, Some(muxer))
            }
        }
        OutputContainerPolicy::KeepInput => {
            let ext = infer_output_extension(None, input_ext);
            let muxer = input_ext
                .map(normalize_muxer_format)
                .filter(|s| !s.is_empty());
            (ext, muxer)
        }
        OutputContainerPolicy::Default => {
            if let Some(preset) = preset
                && preset.advanced_enabled.unwrap_or(false)
                && let Some(template) = preset.ffmpeg_template.as_ref()
                && !template.trim().is_empty()
                && let Some(fmt) = infer_template_output_muxer(template)
            {
                let normalized = normalize_extension_no_dot(&fmt);
                if !normalized.is_empty() {
                    let ext = infer_output_extension(Some(normalized.as_str()), input_ext);
                    return (ext, None);
                }
            }

            let container_format = preset
                .and_then(|p| p.container.as_ref())
                .and_then(|c| c.format.as_deref());
            let ext = infer_output_extension(container_format, input_ext);
            (ext, None)
        }
    }
}

fn infer_template_output_muxer(template: &str) -> Option<String> {
    // Best-effort: look for an output-scoped `-f <muxer>` before OUTPUT.
    // We keep this lightweight and do not attempt full shell parsing.
    let tokens: Vec<&str> = template.split_whitespace().collect();
    let output_index = tokens.iter().position(|t| *t == "OUTPUT")?;
    let mut i = 0usize;
    let mut last_input_index: Option<usize> = None;
    while i + 1 < output_index {
        if tokens[i] == "-i" {
            last_input_index = Some(i + 1);
            i += 2;
            continue;
        }
        i += 1;
    }
    let start = last_input_index.map(|idx| idx + 1).unwrap_or(0);
    let mut j = start;
    let mut fmt: Option<String> = None;
    while j + 1 < output_index {
        if tokens[j] == "-f" {
            fmt = Some(tokens[j + 1].to_string());
            j += 2;
            continue;
        }
        j += 1;
    }
    fmt
}

fn apply_filename_policy(
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
    let tokens: Vec<&str> = template.split_whitespace().collect();
    let mut codec: Option<String> = None;
    let mut quality: Option<String> = None;
    let mut i = 0usize;
    while i + 1 < tokens.len() {
        match tokens[i] {
            "-c:v" => {
                codec = Some(tokens[i + 1].to_string());
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

fn random_hex(len: usize) -> String {
    if len == 0 {
        return String::new();
    }

    let mut out = String::with_capacity(len);
    while out.len() < len {
        let counter = RANDOM_COUNTER.fetch_add(1, Ordering::Relaxed);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut hasher = DefaultHasher::new();
        now.hash(&mut hasher);
        counter.hash(&mut hasher);
        let v = hasher.finish();
        out.push_str(&format!("{v:016x}"));
    }

    out.truncate(len);
    out
}

fn normalize_extension_no_dot(raw: &str) -> String {
    raw.trim().trim_start_matches('.').to_ascii_lowercase()
}

fn sanitize_windows_path_segment(input: &str) -> String {
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
