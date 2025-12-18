use std::path::Path;
use std::process::Command;

use anyhow::{
    Context,
    Result,
};

use super::configure_background_command;
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::tools::{
    ExternalToolKind,
    ensure_tool_available,
};

pub(crate) fn detect_duration_seconds(path: &Path, settings: &AppSettings) -> Result<f64> {
    let (ffprobe_path, _, _) = ensure_tool_available(ExternalToolKind::Ffprobe, &settings.tools)?;
    let mut cmd = Command::new(&ffprobe_path);
    configure_background_command(&mut cmd);
    let output = cmd
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=nw=1:nk=1")
        .arg(path.as_os_str())
        .output()
        .with_context(|| format!("failed to run ffprobe for duration on {}", path.display()))?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "ffprobe failed for {}: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let s = String::from_utf8_lossy(&output.stdout);
    let first = s.lines().next().unwrap_or_default().trim();
    let duration: f64 = first.parse().unwrap_or(0.0);
    Ok(duration)
}

pub(crate) fn detect_video_codec(path: &Path, settings: &AppSettings) -> Result<String> {
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

pub(crate) fn parse_ffprobe_frame_rate(token: &str) -> Option<f64> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some((num, den)) = trimmed.split_once('/') {
        let num: f64 = num.parse().ok()?;
        let den: f64 = den.parse().ok()?;
        if den <= 0.0 {
            return None;
        }
        return Some(num / den);
    }

    trimmed.parse().ok()
}

pub(crate) fn detect_video_dimensions_and_frame_rate(
    path: &Path,
    settings: &AppSettings,
) -> Result<(Option<u32>, Option<u32>, Option<f64>)> {
    let (ffprobe_path, _, _) = ensure_tool_available(ExternalToolKind::Ffprobe, &settings.tools)?;
    let mut cmd = Command::new(&ffprobe_path);
    configure_background_command(&mut cmd);
    let output = cmd
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=width,height,avg_frame_rate")
        .arg("-of")
        .arg("default=nw=1:nk=1")
        .arg(path.as_os_str())
        .output()
        .with_context(|| format!("failed to run ffprobe for dimensions on {}", path.display()))?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "ffprobe failed for {}: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let s = String::from_utf8_lossy(&output.stdout);
    let mut lines = s.lines();
    let width = lines.next().and_then(|l| l.trim().parse::<u32>().ok());
    let height = lines.next().and_then(|l| l.trim().parse::<u32>().ok());
    let frame_rate = lines
        .next()
        .and_then(|l| parse_ffprobe_frame_rate(l.trim()));

    Ok((width, height, frame_rate))
}
