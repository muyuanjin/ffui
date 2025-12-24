use std::path::Path;

use anyhow::Result;

use super::super::worker_utils::{base_seconds_per_mb, encoder_factor_for_estimate};
use crate::ffui_core::domain::FFmpegPreset;
use crate::ffui_core::settings::AppSettings;

pub(super) fn detect_video_codec(path: &Path, settings: &AppSettings) -> Result<String> {
    super::super::ffmpeg_args::detect_video_codec(path, settings)
}

pub(super) fn estimate_job_seconds_for_preset(size_mb: f64, preset: &FFmpegPreset) -> Option<f64> {
    if size_mb <= 0.0 {
        return None;
    }

    let mut seconds_per_mb = base_seconds_per_mb(&preset.stats)?;

    // Adjust for encoder and preset "speed" where we have simple signals so
    // that obviously heavy configurations (e.g. libsvtav1, veryslow) are
    // weighted higher than fast ones.
    let mut factor = encoder_factor_for_estimate(&preset.video.encoder);

    let preset_name = preset.video.preset.to_ascii_lowercase();
    if preset_name.contains("veryslow") {
        factor *= 1.6;
    } else if preset_name.contains("slow") {
        factor *= 1.3;
    } else if preset_name.contains("fast") {
        factor *= 0.8;
    }

    if let Some(pass) = preset.video.pass
        && pass >= 2
    {
        // Two-pass encoding roughly doubles total processing time.
        factor *= 2.0;
    }

    seconds_per_mb *= factor;
    let estimate = size_mb * seconds_per_mb;
    if !estimate.is_finite() || estimate <= 0.0 {
        None
    } else {
        Some(estimate)
    }
}
