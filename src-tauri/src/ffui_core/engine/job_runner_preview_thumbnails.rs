use crate::ffui_core::preview_common::{
    acquire_inflight_lock, ensure_dir_exists, extract_frame_with_seek_backoffs,
    is_non_empty_regular_file, two_stage_seek_args,
};

#[cfg(test)]
fn preview_root_dir() -> PathBuf {
    crate::ffui_core::previews_dir().unwrap_or_else(|_| PathBuf::from(".").join("previews"))
}

fn preview_root_dir_for_writes() -> Option<PathBuf> {
    crate::ffui_core::previews_dir().ok()
}

fn preview_thumb_cache_dir(preview_root: &Path) -> PathBuf {
    preview_root.join("thumb-cache")
}

fn build_preview_output_path_in_root(
    preview_root: &Path,
    input: &Path,
    capture_percent: u8,
    height_px: u16,
    q: u8,
) -> PathBuf {
    const PREVIEW_THUMB_VERSION: u8 = 3;

    let mut hasher = DefaultHasher::new();
    input.to_string_lossy().hash(&mut hasher);
    capture_percent.hash(&mut hasher);
    PREVIEW_THUMB_VERSION.hash(&mut hasher);
    height_px.hash(&mut hasher);
    q.hash(&mut hasher);
    let hash = hasher.finish();
    preview_root.join(format!("{hash:016x}.jpg"))
}

pub(super) fn expected_preview_output_path_for_video(
    input: &Path,
    capture_percent: u8,
) -> Option<PathBuf> {
    let preview_root = crate::ffui_core::previews_dir().ok()?;
    Some(build_preview_output_path_in_root(
        &preview_root,
        input,
        capture_percent,
        180,
        8,
    ))
}

#[cfg(test)]
pub(super) fn build_preview_output_path(input: &Path, capture_percent: u8) -> PathBuf {
    build_preview_output_path_in_root(&preview_root_dir(), input, capture_percent, 180, 8)
}

pub(super) fn compute_preview_seek_seconds(
    total_duration: Option<f64>,
    capture_percent: u8,
) -> f64 {
    const DEFAULT_SEEK_SECONDS: f64 = 3.0;

    let duration = match total_duration {
        Some(d) if d.is_finite() && d > 0.0 => d,
        _ => return DEFAULT_SEEK_SECONDS,
    };

    // Clamp the configured percentage into a sane range so bogus configs
    // cannot cause us to seek past the end.
    let percent = f64::from(capture_percent).clamp(0.0, 100.0);
    let raw = duration * percent / 100.0;

    // Avoid seeking exactly to EOF which can produce a black/empty frame on
    // some demuxers. Keep the clamp small enough so "100%" is still the last
    // meaningful frame.
    let max = (duration - 0.001).max(0.0);
    raw.clamp(0.0, max)
}

fn build_preview_ffmpeg_args_variant(
    fast_ss: &str,
    accurate_ss: &str,
    input: &Path,
    output: &Path,
    height_px: u16,
    q: u8,
) -> Vec<OsString> {
    vec![
        "-y".into(),
        "-hide_banner".into(),
        "-v".into(),
        "error".into(),
        "-ss".into(),
        fast_ss.into(),
        "-i".into(),
        input.as_os_str().into(),
        "-ss".into(),
        accurate_ss.into(),
        "-map".into(),
        "0:v:0".into(),
        "-an".into(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        format!("scale=-2:{height_px}").into(),
        "-q:v".into(),
        q.to_string().into(),
        "-f".into(),
        "image2".into(),
        "-c:v".into(),
        "mjpeg".into(),
        "-pix_fmt".into(),
        "yuvj420p".into(),
        "-strict".into(),
        "-1".into(),
        output.as_os_str().into(),
    ]
}

fn preview_path_is_current(preview_path: &Path, input: &Path) -> bool {
    if !is_non_empty_regular_file(preview_path) {
        return false;
    }

    let preview_modified_ms = fs::metadata(preview_path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis());
    let input_modified_ms = fs::metadata(input)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis());

    match (preview_modified_ms, input_modified_ms) {
        (Some(preview_ms), Some(input_ms)) => preview_ms >= input_ms,
        _ => true,
    }
}

fn align_preview_modified_time_with_input(preview_path: &Path, input: &Path) {
    let input_modified = fs::metadata(input)
        .ok()
        .and_then(|meta| meta.modified().ok());
    let Some(input_modified) = input_modified else {
        return;
    };

    let times = super::file_times::FileTimesSnapshot {
        created: None,
        accessed: None,
        modified: Some(input_modified),
    };
    drop(super::file_times::apply_file_times(preview_path, &times));
}

pub(super) fn generate_preview_for_video(
    input: &Path,
    ffmpeg_path: &str,
    total_duration: Option<f64>,
    capture_percent: u8,
) -> Option<PathBuf> {
    generate_preview_for_video_impl(
        input,
        ffmpeg_path,
        total_duration,
        capture_percent,
        180,
        8,
        false,
    )
}

pub(super) fn generate_preview_for_video_variant(
    input: &Path,
    ffmpeg_path: &str,
    total_duration: Option<f64>,
    capture_percent: u8,
    height_px: u16,
    q: u8,
) -> Option<PathBuf> {
    generate_preview_for_video_impl(
        input,
        ffmpeg_path,
        total_duration,
        capture_percent,
        height_px,
        q,
        true,
    )
}

fn generate_preview_for_video_impl(
    input: &Path,
    ffmpeg_path: &str,
    total_duration: Option<f64>,
    capture_percent: u8,
    height_px: u16,
    q: u8,
    use_thumb_cache_dir: bool,
) -> Option<PathBuf> {
    let preview_root = preview_root_dir_for_writes()?;
    let output_root = if use_thumb_cache_dir && height_px != 180 {
        preview_thumb_cache_dir(&preview_root)
    } else {
        preview_root
    };
    let preview_path =
        build_preview_output_path_in_root(&output_root, input, capture_percent, height_px, q);

    if preview_path_is_current(&preview_path, input) {
        return Some(preview_path);
    }

    let parent = preview_path.parent()?;
    ensure_dir_exists(parent).ok()?;

    let lock_key = format!("preview-thumb:{}", preview_path.to_string_lossy());
    let inflight = acquire_inflight_lock(&lock_key);
    let _guard = inflight.lock_unpoisoned();

    if preview_path_is_current(&preview_path, input) {
        return Some(preview_path);
    }

    let seek_seconds = compute_preview_seek_seconds(total_duration, capture_percent);
    let seek_backoffs_seconds: [f64; 5] = [0.0, 0.25, 0.5, 1.0, 2.0];
    let tmp_path = preview_path.with_extension("part");

    extract_frame_with_seek_backoffs(
        seek_seconds,
        &seek_backoffs_seconds,
        &tmp_path,
        &preview_path,
        "ffmpeg did not produce a preview frame output",
        |attempt_seek_seconds, tmp_path| {
            let (fast_ss_arg, accurate_ss_arg) = two_stage_seek_args(attempt_seek_seconds);
            let mut cmd = Command::new(ffmpeg_path);
            configure_background_command(&mut cmd);
            let status = cmd
                .args(build_preview_ffmpeg_args_variant(
                    &fast_ss_arg,
                    &accurate_ss_arg,
                    input,
                    tmp_path,
                    height_px,
                    q,
                ))
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .with_context(|| {
                    format!(
                        "failed to run ffmpeg preview extraction for {}",
                        input.display()
                    )
                })?;
            if status.success() {
                Ok(())
            } else {
                Err(anyhow::anyhow!(
                    "ffmpeg preview extraction failed with status {status}"
                ))
            }
        },
    )
    .ok()?;

    if is_non_empty_regular_file(&preview_path) {
        align_preview_modified_time_with_input(&preview_path, input);
        return Some(preview_path);
    }

    None
}

#[cfg(test)]
mod preview_thumbnail_args_tests {
    use super::*;

    #[test]
    fn preview_thumbnail_ffmpeg_args_are_scaled_and_mjpeg() {
        let args = build_preview_ffmpeg_args_variant(
            "0.000",
            "1.234",
            Path::new("C:/in.mp4"),
            Path::new("C:/out.jpg"),
            180,
            8,
        );
        let rendered: Vec<String> = args
            .iter()
            .map(|v| v.to_string_lossy().into_owned())
            .collect();

        assert!(
            rendered.iter().any(|v| v == "-an"),
            "preview extraction should disable audio"
        );
        assert!(
            rendered
                .windows(2)
                .any(|w| w[0] == "-vf" && w[1] == "scale=-2:180"),
            "preview extraction should scale down frames"
        );
        assert!(
            rendered.windows(2).any(|w| w[0] == "-q:v" && w[1] == "8"),
            "preview extraction should use a moderate jpeg quality"
        );
        assert!(
            rendered
                .windows(2)
                .any(|w| w[0] == "-c:v" && w[1] == "mjpeg"),
            "preview extraction should force mjpeg for stable jpg outputs"
        );
        assert!(
            rendered
                .windows(2)
                .any(|w| w[0] == "-pix_fmt" && w[1] == "yuvj420p"),
            "preview extraction should use a broadly supported pixel format"
        );
        let i_pos = rendered
            .iter()
            .position(|v| v == "-i")
            .expect("preview extraction should include an input");
        let ss_positions: Vec<usize> = rendered
            .iter()
            .enumerate()
            .filter_map(|(idx, value)| (value == "-ss").then_some(idx))
            .collect();
        assert_eq!(
            ss_positions.len(),
            2,
            "preview extraction should use two-stage seek"
        );
        assert!(
            ss_positions[0] < i_pos,
            "preview extraction should fast-seek before -i"
        );
        assert!(
            ss_positions[1] > i_pos,
            "preview extraction should accurate-seek after -i"
        );
    }

    #[test]
    fn preview_thumbnail_ffmpeg_args_support_other_sizes() {
        let args = build_preview_ffmpeg_args_variant(
            "7.500",
            "1.234",
            Path::new("C:/in.mp4"),
            Path::new("C:/out.jpg"),
            1080,
            6,
        );
        let rendered: Vec<String> = args
            .iter()
            .map(|v| v.to_string_lossy().into_owned())
            .collect();

        assert!(
            rendered
                .windows(2)
                .any(|w| w[0] == "-vf" && w[1] == "scale=-2:1080"),
            "variant preview extraction should scale to the requested height"
        );
        assert!(
            rendered.windows(2).any(|w| w[0] == "-q:v" && w[1] == "6"),
            "variant preview extraction should use the requested jpeg quality"
        );
    }
}
