// ============================================================================
// Path building utilities
// ============================================================================

pub(super) fn build_video_output_path(input: &Path) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    parent.join(format!("{stem}.compressed.{ext}"))
}

// Temporary output path for video transcodes. We keep the final container
// extension (e.g. .mp4) so that ffmpeg can still auto-detect the muxer based
// on the filename, and only insert ".tmp" before the extension. After a
// successful run we rename this file to the stable output path to make the
// operation atomic from the user's perspective.
pub(super) fn build_video_tmp_output_path(input: &Path) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    parent.join(format!("{stem}.compressed.tmp.{ext}"))
}

pub(super) fn build_video_resume_tmp_output_path(input: &Path) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    parent.join(format!("{stem}.compressed.resume.tmp.{ext}"))
}

pub(super) fn concat_video_segments(
    ffmpeg_path: &str,
    first: &Path,
    second: &Path,
    target: &Path,
) -> Result<()> {
    let mut cmd = Command::new(ffmpeg_path);
    configure_background_command(&mut cmd);
    let status = cmd
        .arg("-y")
        .arg("-i")
        .arg(first.as_os_str())
        .arg("-i")
        .arg(second.as_os_str())
        .arg("-filter_complex")
        .arg("[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]")
        .arg("-map")
        .arg("[v]")
        .arg("-map")
        .arg("[a]")
        .arg("-c:v")
        .arg("copy")
        .arg("-c:a")
        .arg("copy")
        .arg(target.as_os_str())
        .status()
        .with_context(|| {
            format!(
                "failed to run ffmpeg concat for {} and {}",
                first.display(),
                second.display()
            )
        })?;

    if !status.success() {
        return Err(anyhow::anyhow!(
            "ffmpeg concat failed with status {status} for {} and {}",
            first.display(),
            second.display()
        ));
    }

    Ok(())
}

fn preview_root_dir() -> PathBuf {
    let exe = std::env::current_exe().ok();
    let dir = exe
        .as_ref()
        .and_then(|p| p.parent())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    dir.join("previews")
}

pub(super) fn build_preview_output_path(input: &Path) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    input.to_string_lossy().hash(&mut hasher);
    let hash = hasher.finish();
    preview_root_dir().join(format!("{hash:016x}.jpg"))
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
    // cannot cause us to seek past the end or before the first second.
    let percent = (capture_percent as f64).clamp(0.0, 100.0);
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

pub(super) fn generate_preview_for_video(
    input: &Path,
    ffmpeg_path: &str,
    total_duration: Option<f64>,
    capture_percent: u8,
) -> Option<PathBuf> {
    let preview_path = build_preview_output_path(input);

    if preview_path.exists() {
        return Some(preview_path);
    }

    if let Some(parent) = preview_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let seek_seconds = compute_preview_seek_seconds(total_duration, capture_percent);
    let ss_arg = format!("{seek_seconds:.3}");

    let mut cmd = Command::new(ffmpeg_path);
    configure_background_command(&mut cmd);
    let status = cmd
        .arg("-y")
        .arg("-ss")
        .arg(&ss_arg)
        .arg("-i")
        .arg(input.as_os_str())
        .arg("-frames:v")
        .arg("1")
        .arg("-q:v")
        .arg("2")
        .arg(preview_path.as_os_str())
        .status()
        .ok()?;

    if status.success() {
        Some(preview_path)
    } else {
        let _ = fs::remove_file(&preview_path);
        None
    }
}
