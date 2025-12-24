use std::path::Path;

use crate::ffui_core::domain::FFmpegPreset;

pub(super) fn should_fallback_webm_forced_container(preset: &FFmpegPreset, input: &Path) -> bool {
    let input_ext = input.extension().and_then(|e| e.to_str());
    crate::ffui_core::engine::output_policy_paths::should_fallback_webm(Some(preset), input_ext)
}
