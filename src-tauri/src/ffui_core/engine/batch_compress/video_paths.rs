use std::path::{Path, PathBuf};

#[cfg(test)]
use super::super::state::EngineState;
use crate::ffui_core::domain::FFmpegPreset;

pub(super) fn build_video_output_path(input: &Path, container_format: Option<&str>) -> PathBuf {
    super::super::job_runner::build_video_output_path(input, container_format)
}

#[cfg(test)]
pub(crate) fn reserve_unique_batch_compress_video_output_path(
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
    let ext =
        crate::ffui_core::engine::ffmpeg_args::infer_output_extension(container_format, input_ext);

    let mut index: u32 = 0;
    loop {
        let candidate = if index == 0 {
            parent.join(format!("{stem}.compressed.{ext}"))
        } else {
            parent.join(format!("{stem}.compressed ({index}).{ext}"))
        };

        let candidate_str = candidate.to_string_lossy().into_owned();
        if !candidate.exists() && !state.known_batch_compress_outputs.contains(&candidate_str) {
            state
                .known_batch_compress_outputs
                .insert(candidate_str.clone());
            break candidate;
        }

        index += 1;
    }
}

pub(super) fn build_video_tmp_output_path(input: &Path, container_format: Option<&str>) -> PathBuf {
    super::super::job_runner::build_video_tmp_output_path(input, container_format)
}

pub(super) fn build_ffmpeg_args(preset: &FFmpegPreset, input: &Path, output: &Path) -> Vec<String> {
    crate::ffui_core::engine::ffmpeg_args::build_ffmpeg_args(preset, input, output, true, None)
}
