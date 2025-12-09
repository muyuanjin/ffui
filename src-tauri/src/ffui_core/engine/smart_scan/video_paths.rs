use std::path::{Path, PathBuf};

use crate::ffui_core::domain::FFmpegPreset;
use crate::ffui_core::engine::ffmpeg_args::infer_output_extension;

use super::super::state::EngineState;

pub(super) fn build_video_output_path(input: &Path, container_format: Option<&str>) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let input_ext = input.extension().and_then(|e| e.to_str());
    let ext = infer_output_extension(container_format, input_ext);
    parent.join(format!("{stem}.compressed.{ext}"))
}

pub(crate) fn reserve_unique_smart_scan_video_output_path(
    state: &mut EngineState,
    input: &Path,
    preset: &FFmpegPreset,
) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let input_ext = input.extension().and_then(|e| e.to_str());
    let container_format = preset.container.as_ref().and_then(|c| c.format.as_deref());
    let ext = infer_output_extension(container_format, input_ext);

    let mut index: u32 = 0;
    loop {
        let candidate = if index == 0 {
            parent.join(format!("{stem}.compressed.{ext}"))
        } else {
            parent.join(format!("{stem}.compressed ({index}).{ext}"))
        };

        let candidate_str = candidate.to_string_lossy().into_owned();
        if !candidate.exists() && !state.known_smart_scan_outputs.contains(&candidate_str) {
            state.known_smart_scan_outputs.insert(candidate_str.clone());
            break candidate;
        }

        index += 1;
    }
}

pub(super) fn build_video_tmp_output_path(input: &Path, container_format: Option<&str>) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let input_ext = input.extension().and_then(|e| e.to_str());
    let ext = infer_output_extension(container_format, input_ext);
    parent.join(format!("{stem}.compressed.tmp.{ext}"))
}

pub(super) fn ensure_progress_args(args: &mut Vec<String>) {
    // Ensure ffmpeg emits machine-readable progress lines so the backend can
    // compute real-time percentages even when the human stats line only uses
    // carriage returns.
    if args.iter().any(|arg| arg == "-progress") {
        return;
    }

    // Use `pipe:2` so structured progress goes to stderr alongside regular logs.
    args.insert(0, "pipe:2".to_string());
    args.insert(0, "-progress".to_string());
}

pub(super) fn build_ffmpeg_args(preset: &FFmpegPreset, input: &Path, output: &Path) -> Vec<String> {
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
        if !args.iter().any(|a| a == "-nostdin") {
            args.push("-nostdin".to_string());
        }
        return args;
    }

    let mut args: Vec<String> = Vec::new();
    ensure_progress_args(&mut args);
    if !args.iter().any(|a| a == "-nostdin") {
        args.push("-nostdin".to_string());
    }

    // Global options.
    if let Some(global) = &preset.global {
        if let Some(behavior) = &global.overwrite_behavior {
            use crate::ffui_core::domain::OverwriteBehavior;
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

    // Input-level options that appear before the first `-i`.
    if let Some(timeline) = &preset.input
        && let Some(crate::ffui_core::domain::SeekMode::Input) = timeline.seek_mode
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

    // Input
    args.push("-i".to_string());
    args.push(input.to_string_lossy().into_owned());

    // Remaining args would be added by the full build_ffmpeg_args implementation
    // For now, we'll reference the parent module's version
    // Note: This is a simplified version - full implementation in engine.rs

    args
}
