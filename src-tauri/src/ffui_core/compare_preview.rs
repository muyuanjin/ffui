use std::ffi::OsString;
use std::fs;
use std::path::{
    Path,
    PathBuf,
};
use std::process::Command;

use anyhow::{
    Context,
    Result,
};

use super::preview_cache::previews_root_dir_best_effort;
use super::preview_common::{
    append_preview_frame_jpeg_args,
    bucket_percent_position,
    bucket_seconds_position,
    configure_background_command,
    extract_frame_with_seek_backoffs,
    file_fingerprint,
    hash_key,
    two_stage_seek_args,
    with_cached_preview_frame,
};
use super::{
    FallbackFramePosition,
    FallbackFrameQuality,
};
use crate::ffui_core::settings::ExternalToolSettings;
use crate::ffui_core::tools::{
    ExternalToolKind,
    ensure_tool_available,
};

mod cache;
use cache::maybe_cleanup_cache_now;

fn compare_cache_root_dir() -> Result<PathBuf> {
    Ok(previews_root_dir_best_effort()?.join("compare-cache"))
}

fn compare_frames_dir() -> Result<PathBuf> {
    Ok(compare_cache_root_dir()?.join("frames"))
}

fn bucket_position(position: FallbackFramePosition, quality: FallbackFrameQuality) -> String {
    match position {
        FallbackFramePosition::Percent(raw) => bucket_percent_position(raw, quality),
        FallbackFramePosition::Seconds(raw) => {
            let step = match quality {
                FallbackFrameQuality::Low => 1.0,
                FallbackFrameQuality::High => 0.5,
            };
            bucket_seconds_position(raw, step)
        }
    }
}

fn build_concat_list_contents(segment_paths: &[PathBuf]) -> String {
    let mut out = String::new();
    for seg in segment_paths {
        let s = seg.to_string_lossy();
        let escaped = s.replace('\'', "'\\''");
        out.push_str("file '");
        out.push_str(&escaped);
        out.push_str("'\n");
    }
    out
}

fn build_concat_ffmpeg_args(
    list_path: &Path,
    position_seconds: f64,
    quality: FallbackFrameQuality,
    tmp_path: &Path,
) -> Vec<OsString> {
    let (fast_ss_arg, accurate_ss_arg) = two_stage_seek_args(position_seconds);
    let mut out: Vec<OsString> = vec![
        "-y".into(),
        "-v".into(),
        "error".into(),
        "-hide_banner".into(),
        // Two-stage seek for concat previews:
        // - First `-ss` (input option) fast-seeks near the target time.
        // - Second `-ss` (output option) decodes forward for frame accuracy.
        // Putting the only `-ss` after `-i` forces decoding from the start and is
        // catastrophic for long-duration scrubs.
        "-ss".into(),
        fast_ss_arg.into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        list_path.as_os_str().to_os_string(),
        "-ss".into(),
        accurate_ss_arg.into(),
        "-frames:v".into(),
        "1".into(),
        "-an".into(),
    ];

    append_preview_frame_jpeg_args(&mut out, quality, "3");
    out.push(tmp_path.as_os_str().to_os_string());

    out
}

pub(crate) fn extract_concat_preview_frame(
    segment_paths: &[String],
    tools: &ExternalToolSettings,
    position_seconds: f64,
    quality: FallbackFrameQuality,
) -> Result<PathBuf> {
    if segment_paths.is_empty() {
        return Err(anyhow::anyhow!("segmentPaths must not be empty"));
    }

    let segments: Vec<PathBuf> = segment_paths.iter().map(PathBuf::from).collect();
    for seg in &segments {
        let meta = match fs::metadata(seg) {
            Ok(m) => m,
            Err(err) => {
                return Err(anyhow::anyhow!(
                    "segmentPaths contains a non-readable file: {}: {err}",
                    seg.display()
                ));
            }
        };
        if !meta.is_file() {
            return Err(anyhow::anyhow!(
                "segmentPaths contains a non-file path: {}",
                seg.display()
            ));
        }
    }

    let canonical_for_key: Vec<PathBuf> = segments
        .iter()
        .map(|p| p.canonicalize().unwrap_or_else(|_| p.to_path_buf()))
        .collect();
    let fingerprints: Vec<(u64, Option<u128>)> = canonical_for_key
        .iter()
        .map(|p| file_fingerprint(p))
        .collect();

    let bucket = bucket_position(FallbackFramePosition::Seconds(position_seconds), quality);
    let mut key = format!("concatframe:{bucket}:{}", quality.as_str());
    for (index, seg) in canonical_for_key.iter().enumerate() {
        let (len, modified_ms) = fingerprints.get(index).copied().unwrap_or((0, None));
        key.push('|');
        key.push_str(&format!(
            "{}:{}:{}",
            seg.display(),
            len,
            modified_ms.unwrap_or(0)
        ));
    }

    let hash = hash_key(&[&key]);
    let frames_dir = compare_frames_dir()?;
    let cache_root = compare_cache_root_dir()?;
    let list_path = frames_dir.join(format!("{hash:016x}.concat.list"));
    let list_contents = build_concat_list_contents(&segments);

    let (ffmpeg_path, _, _) = ensure_tool_available(ExternalToolKind::Ffmpeg, tools)?;
    let seek_backoffs_seconds: [f64; 5] = [0.0, 0.25, 0.5, 1.0, 2.0];

    with_cached_preview_frame(
        &key,
        &frames_dir,
        &cache_root,
        hash,
        maybe_cleanup_cache_now,
        |tmp_path, final_path| {
            fs::write(&list_path, list_contents.as_bytes())
                .with_context(|| format!("failed to write concat list {}", list_path.display()))?;

            let result = extract_frame_with_seek_backoffs(
                position_seconds.max(0.0),
                &seek_backoffs_seconds,
                tmp_path,
                final_path,
                "ffmpeg did not produce a concat preview frame output",
                |attempt_seconds, tmp_path| {
                    let mut cmd = Command::new(&ffmpeg_path);
                    configure_background_command(&mut cmd);

                    let args =
                        build_concat_ffmpeg_args(&list_path, attempt_seconds, quality, tmp_path);
                    cmd.args(args);

                    let output = cmd
                        .output()
                        .with_context(|| "failed to run ffmpeg concat frame extraction")?;

                    if !output.status.success() {
                        let _ = fs::remove_file(tmp_path);
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        return Err(anyhow::anyhow!(
                            "ffmpeg concat frame extraction failed with status {}: {}",
                            output.status,
                            stderr.trim()
                        ));
                    }

                    Ok(())
                },
            );

            let _ = fs::remove_file(&list_path);
            result.map(|_| ())
        },
    )
}

#[cfg(test)]
pub(crate) fn compare_frames_dir_for_tests() -> PathBuf {
    compare_frames_dir().unwrap_or_else(|_| PathBuf::from("previews").join("compare-cache/frames"))
}

#[cfg(test)]
pub(crate) fn build_concat_list_contents_for_tests(segment_paths: &[PathBuf]) -> String {
    build_concat_list_contents(segment_paths)
}

#[cfg(test)]
mod tests;
