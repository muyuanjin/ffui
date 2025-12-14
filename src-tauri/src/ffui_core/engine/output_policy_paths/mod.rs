use std::path::{Path, PathBuf};

use crate::ffui_core::domain::{
    FFmpegPreset, JobWarning, OutputContainerPolicy, OutputDirectoryPolicy, OutputPolicy,
};

use super::ffmpeg_args::{
    infer_output_extension, normalize_container_format as normalize_muxer_format,
};

mod filename;
mod template;
mod utils;
mod webm;

use filename::{apply_filename_policy, sanitize_windows_path_segment};
use template::infer_template_output_muxer;
use utils::{normalize_extension_no_dot, random_hex};
use webm::should_fallback_webm;

use std::sync::atomic::AtomicU64;

static RANDOM_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OutputPathPlan {
    pub(crate) output_path: PathBuf,
    pub(crate) forced_muxer: Option<String>,
    pub(crate) warnings: Vec<JobWarning>,
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

    let (ext, forced_muxer, warnings) =
        infer_container_extension_and_muxer(input_ext, preset, policy);

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
        warnings,
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
    let (ext, forced_muxer, warnings) =
        infer_container_extension_and_muxer(input_ext, preset, policy);

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
        warnings,
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
) -> (String, Option<String>, Vec<JobWarning>) {
    let mut warnings: Vec<JobWarning> = Vec::new();
    match &policy.container {
        OutputContainerPolicy::Force { format } => {
            let raw = format.trim().trim_start_matches('.');
            let requested_ext = normalize_extension_no_dot(raw);
            let muxer = normalize_muxer_format(&requested_ext);

            if muxer.is_empty() {
                let ext = infer_output_extension(None, input_ext);
                (ext, None, warnings)
            } else {
                // Keep the user-selected extension even when the muxer name differs
                // (e.g. wmv -> asf, ts/m2ts -> mpegts, m4a -> mp4).
                let mut ext = if !requested_ext.is_empty() {
                    requested_ext
                } else {
                    infer_output_extension(Some(muxer.as_str()), input_ext)
                };
                let mut forced_muxer = Some(muxer);

                // WebM is a strict container: it only supports VP8/VP9/AV1 video and
                // Vorbis/Opus audio. FFUI's structured presets cannot encode Opus/Vorbis
                // today, and `copy` is not safe unless we know the input is already WebM.
                //
                // When forcing WebM would obviously fail, fall back to Matroska to avoid
                // generating an invalid ffmpeg invocation.
                if forced_muxer.as_deref() == Some("webm")
                    && should_fallback_webm(preset, input_ext)
                {
                    ext = "mkv".to_string();
                    forced_muxer = Some("matroska".to_string());
                    warnings.push(JobWarning {
                        code: "forcedContainerFallback".to_string(),
                        message: "Forced container '.webm' is incompatible with the current codec settings; falling back to '.mkv' (matroska). WebM only supports VP8/VP9/AV1 video and Vorbis/Opus audio.".to_string(),
                    });
                }

                (ext, forced_muxer, warnings)
            }
        }
        OutputContainerPolicy::KeepInput => {
            let ext = infer_output_extension(None, input_ext);
            let muxer = input_ext
                .map(normalize_muxer_format)
                .filter(|s| !s.is_empty());
            (ext, muxer, warnings)
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
                    return (ext, None, warnings);
                }
            }

            let container_format = preset
                .and_then(|p| p.container.as_ref())
                .and_then(|c| c.format.as_deref());
            let ext = infer_output_extension(container_format, input_ext);
            (ext, None, warnings)
        }
    }
}
