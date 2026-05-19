use std::path::{Path, PathBuf};

use super::builder::{build_ffmpeg_args, derive_two_pass_log_prefix};
use crate::ffui_core::domain::{FFmpegPreset, OutputPolicy};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FfmpegRunKind {
    Single,
    TwoPassFirst,
    TwoPassSecond,
}

#[derive(Debug, Clone)]
pub(crate) struct FfmpegPlannedRun {
    pub(crate) kind: FfmpegRunKind,
    pub(crate) args: Vec<String>,
}

pub(crate) fn preset_requires_two_pass(preset: &FFmpegPreset) -> bool {
    super::two_pass_policy::preset_uses_structured_two_pass(preset)
}

pub(crate) fn build_ffmpeg_run_plan(
    preset: &FFmpegPreset,
    input: &Path,
    output: &Path,
    non_interactive: bool,
    output_policy: Option<&OutputPolicy>,
) -> Result<Vec<FfmpegPlannedRun>, String> {
    validate_structured_execution_preset(preset)?;
    if !preset_requires_two_pass(preset) {
        return Ok(vec![FfmpegPlannedRun {
            kind: FfmpegRunKind::Single,
            args: build_ffmpeg_args(preset, input, output, non_interactive, output_policy),
        }]);
    }

    let pass_one =
        build_ffmpeg_two_pass_first_args(preset, input, output, non_interactive, output_policy);
    let pass_two =
        build_ffmpeg_two_pass_second_args(preset, input, output, non_interactive, output_policy);

    Ok(vec![
        FfmpegPlannedRun {
            kind: FfmpegRunKind::TwoPassFirst,
            args: pass_one,
        },
        FfmpegPlannedRun {
            kind: FfmpegRunKind::TwoPassSecond,
            args: pass_two,
        },
    ])
}

pub(crate) fn validate_structured_execution_preset(preset: &FFmpegPreset) -> Result<(), String> {
    let uses_template = preset.advanced_enabled.unwrap_or(false)
        && preset
            .ffmpeg_template
            .as_ref()
            .is_some_and(|template| !template.trim().is_empty());
    if uses_template {
        return Ok(());
    }
    if !preset.video.rate_control.is_known() && !preset.video.encoder.is_copy() {
        return Err(format!(
            "unsupported rateControl for structured execution: {}",
            preset.video.rate_control.as_str()
        ));
    }
    Ok(())
}

pub(crate) fn two_pass_artifact_paths(output: &Path) -> Vec<PathBuf> {
    let prefix = derive_two_pass_log_prefix(output);
    let mut paths: Vec<PathBuf> = [
        prefix.clone(),
        format!("{prefix}-0.log"),
        format!("{prefix}-0.log.mbtree"),
        format!("{prefix}.log"),
        format!("{prefix}.log.mbtree"),
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect();
    append_existing_numbered_two_pass_artifacts(&mut paths, &prefix);
    paths
}

fn append_existing_numbered_two_pass_artifacts(paths: &mut Vec<PathBuf>, prefix: &str) {
    let prefix_path = Path::new(prefix);
    let Some(file_prefix) = prefix_path.file_name().and_then(|name| name.to_str()) else {
        return;
    };
    let dir = prefix_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if is_numbered_two_pass_artifact(file_name, file_prefix) && !paths.contains(&path) {
            paths.push(path);
        }
    }
}

fn is_numbered_two_pass_artifact(file_name: &str, file_prefix: &str) -> bool {
    let Some(suffix) = file_name.strip_prefix(file_prefix) else {
        return false;
    };
    let Some(stream_suffix) = suffix
        .strip_suffix(".log")
        .or_else(|| suffix.strip_suffix(".log.mbtree"))
    else {
        return false;
    };
    stream_suffix
        .strip_prefix('-')
        .is_some_and(|stream| !stream.is_empty() && stream.chars().all(|ch| ch.is_ascii_digit()))
}

pub(crate) fn rewrite_two_pass_log_prefix(args: &mut [String], output: &Path) {
    let prefix = derive_two_pass_log_prefix(output);
    if let Some(idx) = args.iter().position(|arg| arg == "-passlogfile")
        && let Some(value) = args.get_mut(idx + 1)
    {
        *value = prefix;
    }
}

fn null_output_path() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
}

fn build_ffmpeg_two_pass_second_args(
    preset: &FFmpegPreset,
    input: &Path,
    output: &Path,
    non_interactive: bool,
    output_policy: Option<&OutputPolicy>,
) -> Vec<String> {
    let mut pass_two = preset.clone();
    pass_two.video.pass = Some(2);
    build_ffmpeg_args(&pass_two, input, output, non_interactive, output_policy)
}

fn build_ffmpeg_two_pass_first_args(
    preset: &FFmpegPreset,
    input: &Path,
    output: &Path,
    non_interactive: bool,
    output_policy: Option<&OutputPolicy>,
) -> Vec<String> {
    let mut pass_one = preset.clone();
    pass_one.video.pass = Some(1);
    let mut args = build_ffmpeg_args(&pass_one, input, output, non_interactive, output_policy);
    rewrite_as_null_video_analysis(&mut args, output);
    args
}

fn rewrite_as_null_video_analysis(args: &mut Vec<String>, output: &Path) {
    let output_arg = output.to_string_lossy().into_owned();
    if let Some(output_idx) = args.iter().rposition(|arg| arg == &output_arg) {
        args.truncate(output_idx);
    }

    remove_options_with_values(
        args,
        &[
            "-c:a",
            "-b:a",
            "-ar",
            "-ac",
            "-channel_layout",
            "-af",
            "-f",
            "-movflags",
            "-bsf",
        ],
    );
    remove_flags(args, &["-sn"]);
    args.extend([
        "-an".to_string(),
        "-sn".to_string(),
        "-dn".to_string(),
        "-f".to_string(),
        "null".to_string(),
        null_output_path().to_string(),
    ]);
}

fn remove_options_with_values(args: &mut Vec<String>, options: &[&str]) {
    let mut idx = 0;
    while idx < args.len() {
        if options.iter().any(|option| args[idx] == *option) {
            args.remove(idx);
            if idx < args.len() {
                args.remove(idx);
            }
        } else {
            idx += 1;
        }
    }
}

fn remove_flags(args: &mut Vec<String>, flags: &[&str]) {
    args.retain(|arg| !flags.iter().any(|flag| arg == flag));
}
