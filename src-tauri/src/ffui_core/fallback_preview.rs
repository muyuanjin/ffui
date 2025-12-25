use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result};

use super::preview_common::{
    append_preview_frame_jpeg_args, bucket_percent_position, bucket_seconds_position,
    configure_background_command, extract_frame_with_seek_backoffs, file_fingerprint, hash_key,
    is_regular_file, two_stage_seek_args, with_cached_preview_frame,
};
use crate::ffui_core::ffprobe::ffprobe_format_duration_seconds;
use crate::ffui_core::settings::ExternalToolSettings;
use crate::ffui_core::tools::{ExternalToolKind, ensure_tool_available};

mod cache;
use cache::maybe_cleanup_cache_now;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FallbackFrameQuality {
    Low,
    High,
}
impl FallbackFrameQuality {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::High => "high",
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FallbackFramePosition {
    Percent(f64),
    Seconds(f64),
}

// Keep FFmpeg filter graphs extremely conservative. Some user-provided FFmpeg
// builds exit with AVERROR(EINVAL) for newer scale options (e.g.
// force_original_aspect_ratio) or expressions that require escaping.
#[cfg(test)]
const LOW_QUALITY_FRAME_VF: &str = "scale=-2:360";
fn previews_root_dir() -> Result<PathBuf> {
    // Avoid canonicalizing on Windows: `std::fs::canonicalize` may introduce a
    // `\\?\` verbatim prefix, and some FFmpeg builds fail to open such paths.
    crate::ffui_core::previews_dir()
}
fn fallback_cache_root_dir() -> Result<PathBuf> {
    Ok(previews_root_dir()?.join("fallback-cache"))
}
fn fallback_frames_dir() -> Result<PathBuf> {
    Ok(fallback_cache_root_dir()?.join("frames"))
}

pub(crate) fn clear_fallback_frame_cache() -> Result<usize> {
    let dir = fallback_frames_dir()?;
    if !dir.exists() {
        return Ok(0);
    }

    let mut deleted = 0usize;
    for entry in
        fs::read_dir(&dir).with_context(|| format!("read_dir failed for {}", dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if !is_regular_file(&path) {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }
    Ok(deleted)
}

fn clamp_seek_seconds(total_duration: Option<f64>, requested_seconds: f64) -> f64 {
    if !requested_seconds.is_finite() {
        return 0.0;
    }

    let requested = requested_seconds.max(0.0);

    let Some(duration) = total_duration.filter(|d| d.is_finite() && *d > 0.0) else {
        return requested;
    };

    if duration <= 0.0 {
        return requested;
    }

    let max = (duration - 0.001).max(0.0);
    requested.min(max)
}

fn bucket_position(position: FallbackFramePosition, quality: FallbackFrameQuality) -> String {
    match position {
        FallbackFramePosition::Percent(raw) => bucket_percent_position(raw, quality),
        FallbackFramePosition::Seconds(raw) => {
            let step = match quality {
                // Compare scrubbing uses low-quality frames while moving the slider and expects
                // reasonably tight alignment; keep caching granular enough to avoid "wrong frame"
                // reports for long GOP sources.
                FallbackFrameQuality::Low => 0.2,
                FallbackFrameQuality::High => 0.1,
            };
            bucket_seconds_position(raw, step)
        }
    }
}

fn detect_duration_seconds_with_ffprobe(path: &Path, tools: &ExternalToolSettings) -> Result<f64> {
    let (ffprobe_path, _, _) = ensure_tool_available(ExternalToolKind::Ffprobe, tools)?;
    ffprobe_format_duration_seconds(Path::new(&ffprobe_path), path, configure_background_command)
}

fn build_fallback_ffmpeg_args(
    source: &Path,
    fast_ss_arg: &str,
    accurate_ss_arg: &str,
    quality: FallbackFrameQuality,
    tmp_path: &Path,
) -> Vec<OsString> {
    let mut out: Vec<OsString> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-v".into(),
        "error".into(),
        "-ss".into(),
        fast_ss_arg.into(),
        "-i".into(),
        source.as_os_str().to_os_string(),
        "-ss".into(),
        accurate_ss_arg.into(),
        "-frames:v".into(),
        "1".into(),
        "-an".into(),
    ];

    append_preview_frame_jpeg_args(&mut out, quality, "2");
    out.push(tmp_path.as_os_str().to_os_string());

    out
}

pub fn extract_fallback_frame(
    source_path: &str,
    tools: &ExternalToolSettings,
    duration_seconds_hint: Option<f64>,
    position: FallbackFramePosition,
    quality: FallbackFrameQuality,
) -> Result<PathBuf> {
    let source = Path::new(source_path);
    let meta = match fs::metadata(source) {
        Ok(m) => m,
        Err(err) => {
            return Err(anyhow::anyhow!(
                "sourcePath is not a readable file: {}: {err}",
                source.display()
            ));
        }
    };
    if !meta.is_file() {
        return Err(anyhow::anyhow!(
            "sourcePath is not a file: {}",
            source.display()
        ));
    }

    // `canonicalize` may introduce a Windows `\\?\` prefix. We still prefer it
    // for cache keys, but fall back to the raw path when it fails.
    let canonical_for_key = source
        .canonicalize()
        .unwrap_or_else(|_| source.to_path_buf());

    let (len, modified_ms) = file_fingerprint(&canonical_for_key);
    let bucket = bucket_position(position, quality);
    let key = format!(
        "frame:{}:{}:{}:{}",
        canonical_for_key.display(),
        bucket,
        quality.as_str(),
        modified_ms.unwrap_or(0)
    );
    let hash = hash_key(&[&key, &len.to_string()]);

    let frames_dir = fallback_frames_dir()?;
    let cache_root = fallback_cache_root_dir()?;
    let (ffmpeg_path, _, _) = ensure_tool_available(ExternalToolKind::Ffmpeg, tools)?;
    let seek_backoffs_seconds: [f64; 5] = [0.0, 0.25, 0.5, 1.0, 2.0];

    with_cached_preview_frame(
        &key,
        &frames_dir,
        &cache_root,
        hash,
        maybe_cleanup_cache_now,
        |tmp_path, final_path| {
            let total_duration = match position {
                FallbackFramePosition::Percent(_) => duration_seconds_hint
                    .filter(|d| d.is_finite() && *d > 0.0)
                    .or_else(|| {
                        detect_duration_seconds_with_ffprobe(source, tools)
                            .ok()
                            .filter(|d| d.is_finite() && *d > 0.0)
                    }),
                FallbackFramePosition::Seconds(_) => duration_seconds_hint,
            };

            let requested_seconds = match position {
                FallbackFramePosition::Percent(p) => {
                    let duration = total_duration.unwrap_or(0.0);
                    duration * p.clamp(0.0, 100.0) / 100.0
                }
                FallbackFramePosition::Seconds(s) => s,
            };

            let _ = fs::remove_file(final_path);

            let seek_seconds = clamp_seek_seconds(total_duration, requested_seconds);
            let _seek_used = extract_frame_with_seek_backoffs(
                seek_seconds,
                &seek_backoffs_seconds,
                tmp_path,
                final_path,
                "ffmpeg did not produce a fallback preview frame output",
                |attempt_seek_seconds, tmp_path| {
                    let (fast_ss_arg, accurate_ss_arg) = two_stage_seek_args(attempt_seek_seconds);

                    let mut cmd = Command::new(&ffmpeg_path);
                    configure_background_command(&mut cmd);
                    cmd.args(build_fallback_ffmpeg_args(
                        source,
                        &fast_ss_arg,
                        &accurate_ss_arg,
                        quality,
                        tmp_path,
                    ));

                    let output = cmd.output().with_context(|| {
                        format!(
                            "failed to run ffmpeg to extract a frame for {}",
                            source.display()
                        )
                    })?;

                    if !output.status.success() {
                        let _ = fs::remove_file(tmp_path);
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        return Err(anyhow::anyhow!(
                            "ffmpeg exited with status {}: {}",
                            output.status,
                            stderr.trim()
                        ));
                    }

                    Ok(())
                },
            )?;

            Ok(())
        },
    )
}

#[cfg(test)]
mod tests;
