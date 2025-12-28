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
    const PREVIEW_THUMB_VERSION: u8 = 2;

    let mut hasher = DefaultHasher::new();
    input.to_string_lossy().hash(&mut hasher);
    capture_percent.hash(&mut hasher);
    PREVIEW_THUMB_VERSION.hash(&mut hasher);
    height_px.hash(&mut hasher);
    q.hash(&mut hasher);
    let hash = hasher.finish();
    preview_root.join(format!("{hash:016x}.jpg"))
}

pub(super) fn expected_preview_output_path_for_video(input: &Path, capture_percent: u8) -> Option<PathBuf> {
    let preview_root = crate::ffui_core::previews_dir().ok()?;
    Some(build_preview_output_path_in_root(&preview_root, input, capture_percent, 180, 8))
}

#[cfg(test)]
pub(super) fn build_preview_output_path(input: &Path, capture_percent: u8) -> PathBuf {
    build_preview_output_path_in_root(&preview_root_dir(), input, capture_percent, 180, 8)
}

pub(super) fn compute_preview_seek_seconds(total_duration: Option<f64>, capture_percent: u8) -> f64 {
    const DEFAULT_SEEK_SECONDS: f64 = 3.0;

    let duration = match total_duration {
        Some(d) if d.is_finite() && d > 0.0 => d,
        _ => return DEFAULT_SEEK_SECONDS,
    };

    // Clamp the configured percentage into a sane range so bogus configs
    // cannot cause us to seek past the end or before the first second.
    let percent = f64::from(capture_percent).clamp(0.0, 100.0);
    let raw = duration * percent / 100.0;

    // For very short clips, prefer a simple midpoint to avoid degenerate
    // ranges where `duration - 1` becomes <= 1.
    if duration <= 2.0 {
        return (duration / 2.0).max(0.0);
    }

    let min = 1.0;
    let max = (duration - 1.0).max(min);
    raw.clamp(min, max)
}

fn build_preview_ffmpeg_args_variant(
    ss: &str,
    input: &Path,
    output: &Path,
    height_px: u16,
    q: u8,
) -> Vec<OsString> {
    vec![
        "-y".into(),
        "-ss".into(),
        ss.into(),
        "-i".into(),
        input.as_os_str().into(),
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
    let preview_path = build_preview_output_path_in_root(&output_root, input, capture_percent, height_px, q);

    if preview_path.exists() {
        return Some(preview_path);
    }

    if let Some(parent) = preview_path.parent() {
        drop(fs::create_dir_all(parent));
    }

    let seek_seconds = compute_preview_seek_seconds(total_duration, capture_percent);
    let ss_arg = format!("{seek_seconds:.3}");

    let mut cmd = Command::new(ffmpeg_path);
    configure_background_command(&mut cmd);
    let status = cmd
        .args(build_preview_ffmpeg_args_variant(
            &ss_arg,
            input,
            &preview_path,
            height_px,
            q,
        ))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()?;

    if status.success() {
        Some(preview_path)
    } else {
        drop(fs::remove_file(&preview_path));
        None
    }
}

#[cfg(test)]
mod preview_thumbnail_args_tests {
    use super::*;

    #[test]
    fn preview_thumbnail_ffmpeg_args_are_scaled_and_mjpeg() {
        let args = build_preview_ffmpeg_args_variant(
            "1.234",
            Path::new("C:/in.mp4"),
            Path::new("C:/out.jpg"),
            180,
            8,
        );
        let rendered: Vec<String> = args.iter().map(|v| v.to_string_lossy().into_owned()).collect();

        assert!(rendered.iter().any(|v| v == "-an"), "preview extraction should disable audio");
        assert!(
            rendered.windows(2).any(|w| w[0] == "-vf" && w[1] == "scale=-2:180"),
            "preview extraction should scale down frames"
        );
        assert!(
            rendered.windows(2).any(|w| w[0] == "-q:v" && w[1] == "8"),
            "preview extraction should use a moderate jpeg quality"
        );
        assert!(
            rendered.windows(2).any(|w| w[0] == "-c:v" && w[1] == "mjpeg"),
            "preview extraction should force mjpeg for stable jpg outputs"
        );
        assert!(
            rendered.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuvj420p"),
            "preview extraction should use a broadly supported pixel format"
        );
    }

    #[test]
    fn preview_thumbnail_ffmpeg_args_support_other_sizes() {
        let args = build_preview_ffmpeg_args_variant(
            "1.234",
            Path::new("C:/in.mp4"),
            Path::new("C:/out.jpg"),
            1080,
            6,
        );
        let rendered: Vec<String> = args.iter().map(|v| v.to_string_lossy().into_owned()).collect();

        assert!(
            rendered.windows(2).any(|w| w[0] == "-vf" && w[1] == "scale=-2:1080"),
            "variant preview extraction should scale to the requested height"
        );
        assert!(
            rendered.windows(2).any(|w| w[0] == "-q:v" && w[1] == "6"),
            "variant preview extraction should use the requested jpeg quality"
        );
    }
}
