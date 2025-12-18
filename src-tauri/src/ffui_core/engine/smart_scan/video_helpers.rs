use std::path::Path;
use std::process::Command;

use anyhow::{
    Context,
    Result,
};

use super::super::ffmpeg_args::configure_background_command;
use crate::ffui_core::domain::FFmpegPreset;
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::tools::{
    ExternalToolKind,
    ensure_tool_available,
};

pub(super) fn detect_video_codec(path: &Path, settings: &AppSettings) -> Result<String> {
    let (ffprobe_path, _, _) = ensure_tool_available(ExternalToolKind::Ffprobe, &settings.tools)?;
    let mut cmd = Command::new(&ffprobe_path);
    configure_background_command(&mut cmd);
    let output = cmd
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=codec_name")
        .arg("-of")
        .arg("default=nw=1:nk=1")
        .arg(path.as_os_str())
        .output()
        .with_context(|| {
            let display = path.display();
            format!("failed to run ffprobe on {display}")
        })?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "ffprobe failed for {}: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let s = String::from_utf8_lossy(&output.stdout);
    Ok(s.lines().next().unwrap_or_default().trim().to_string())
}

pub(super) fn estimate_job_seconds_for_preset(size_mb: f64, preset: &FFmpegPreset) -> Option<f64> {
    if size_mb <= 0.0 {
        return None;
    }

    let stats = &preset.stats;
    if stats.total_input_size_mb <= 0.0 || stats.total_time_seconds <= 0.0 {
        return None;
    }

    // Baseline: average seconds-per-megabyte observed for this preset.
    let mut seconds_per_mb = stats.total_time_seconds / stats.total_input_size_mb;
    if !seconds_per_mb.is_finite() || seconds_per_mb <= 0.0 {
        return None;
    }

    // Adjust for encoder and preset "speed" where we have simple signals so
    // that obviously heavy configurations (e.g. libsvtav1, veryslow) are
    // weighted higher than fast ones.
    use crate::ffui_core::domain::EncoderType;

    let mut factor = 1.0f64;

    match preset.video.encoder {
        EncoderType::LibSvtAv1 => {
            // Modern AV1 encoders tend to be considerably slower.
            factor *= 1.5;
        }
        EncoderType::HevcNvenc => {
            // Hardware HEVC is usually fast; keep this close to 1.0 so size
            // remains the dominant factor.
            factor *= 0.9;
        }
        _ => {}
    }

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
