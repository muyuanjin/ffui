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

fn parse_first_non_empty_line_as_f64(stdout: &[u8]) -> Option<f64> {
    let s = String::from_utf8_lossy(stdout);
    for raw in s.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(v) = line.parse::<f64>()
            && v.is_finite()
            && v > 0.0
        {
            return Some(v);
        }
    }
    None
}

fn parse_time_base_and_duration_ts(stdout: &[u8]) -> Option<f64> {
    let s = String::from_utf8_lossy(stdout);
    let mut time_base: Option<f64> = None;
    let mut duration_ts: Option<u64> = None;

    for raw in s.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if time_base.is_none() && line.contains('/') {
            time_base = parse_ffprobe_frame_rate(line).filter(|v| v.is_finite() && *v > 0.0);
            continue;
        }
        if duration_ts.is_none() {
            duration_ts = line.parse::<u64>().ok();
        }
    }

    let time_base = time_base?;
    let duration_ts = duration_ts?;
    let seconds = (duration_ts as f64) * time_base;
    if seconds.is_finite() && seconds > 0.0 {
        Some(seconds)
    } else {
        None
    }
}

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

pub(crate) fn detect_video_stream_duration_seconds(
    path: &Path,
    settings: &AppSettings,
) -> Result<f64> {
    let (ffprobe_path, _, _) = ensure_tool_available(ExternalToolKind::Ffprobe, &settings.tools)?;

    // Prefer stream duration so copied audio tails do not inflate the measured
    // segment duration (which would make resume seek points drift forward and
    // drop video frames after multiple pause/resume cycles).
    let mut cmd = Command::new(&ffprobe_path);
    configure_background_command(&mut cmd);
    let output = cmd
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=duration")
        .arg("-of")
        .arg("default=nw=1:nk=1")
        .arg(path.as_os_str())
        .output()
        .with_context(|| {
            format!(
                "failed to run ffprobe for stream duration on {}",
                path.display()
            )
        })?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "ffprobe failed for {}: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    if let Some(v) = parse_first_non_empty_line_as_f64(&output.stdout) {
        return Ok(v);
    }

    // Fall back to duration_ts/time_base when stream=duration is missing (N/A).
    let mut cmd = Command::new(&ffprobe_path);
    configure_background_command(&mut cmd);
    let output = cmd
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=time_base,duration_ts")
        .arg("-of")
        .arg("default=nw=1:nk=1")
        .arg(path.as_os_str())
        .output()
        .with_context(|| {
            format!(
                "failed to run ffprobe for stream duration_ts/time_base on {}",
                path.display()
            )
        })?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "ffprobe failed for {}: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    if let Some(v) = parse_time_base_and_duration_ts(&output.stdout) {
        return Ok(v);
    }

    Err(anyhow::anyhow!(
        "ffprobe returned no usable video stream duration for {}",
        path.display()
    ))
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

#[cfg(test)]
mod detect_tests {
    use super::*;

    #[test]
    fn parse_first_non_empty_line_as_f64_ignores_empty_and_invalid_lines() {
        let raw = b"\n \nN/A\n0\n12.345\n";
        assert_eq!(parse_first_non_empty_line_as_f64(raw), Some(12.345));
    }

    #[test]
    fn parse_time_base_and_duration_ts_computes_seconds() {
        let raw = b"1/1000\n36223129\n";
        let seconds = parse_time_base_and_duration_ts(raw).expect("parse duration");
        assert!((seconds - 36223.129).abs() < 0.000_001);
    }

    #[test]
    fn parse_time_base_and_duration_ts_accepts_swapped_line_order() {
        let raw = b"36223129\n1/1000\n";
        let seconds = parse_time_base_and_duration_ts(raw).expect("parse duration");
        assert!((seconds - 36223.129).abs() < 0.000_001);
    }
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
