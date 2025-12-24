use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::{
    Path,
    PathBuf,
};
use std::process::Command;
use std::sync::{
    Arc,
    Mutex,
};
use std::time::SystemTime;

use anyhow::{
    Context,
    Result,
};
use once_cell::sync::Lazy;

use crate::ffui_core::settings::ExternalToolSettings;
use crate::ffui_core::tools::{
    ExternalToolKind,
    ensure_tool_available,
};
use crate::sync_ext::MutexExt;

mod cache;
use cache::maybe_cleanup_cache_now;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FallbackFrameQuality {
    Low,
    High,
}
impl FallbackFrameQuality {
    pub fn as_str(&self) -> &'static str {
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
const LOW_QUALITY_FRAME_VF: &str = "scale=-2:360";

static INFLIGHT_LOCKS: Lazy<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[cfg(windows)]
fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn configure_background_command(_cmd: &mut Command) {}
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
fn ensure_dir_exists(path: &Path) -> Result<()> {
    fs::create_dir_all(path)
        .with_context(|| format!("create_dir_all failed for {}", path.display()))
}
pub(super) fn is_regular_file(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

fn is_non_empty_regular_file(path: &Path) -> bool {
    is_regular_file(path) && fs::metadata(path).map(|m| m.len() > 0).unwrap_or(false)
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
fn file_fingerprint(path: &Path) -> (u64, Option<u128>) {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return (0, None),
    };
    let len = meta.len();
    let modified_ms = meta.modified().ok().and_then(|t| {
        t.duration_since(SystemTime::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_millis())
    });
    (len, modified_ms)
}
fn hash_key(parts: &[&str]) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{
        Hash,
        Hasher,
    };
    let mut hasher = DefaultHasher::new();
    for part in parts {
        part.hash(&mut hasher);
    }
    hasher.finish()
}

fn frame_tmp_filename(hash: u64) -> String {
    // Use a pure temporary extension and rely on `-f` / explicit codecs instead
    // of output filename inference.
    format!("{hash:016x}.part")
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

fn two_stage_seek_args(seek_seconds: f64) -> (String, String) {
    if !seek_seconds.is_finite() {
        return ("0.000".to_string(), "0.000".to_string());
    }

    let seek_seconds = seek_seconds.max(0.0);
    let fast_seek_seconds = (seek_seconds - 3.0).max(0.0);
    let accurate_offset_seconds = (seek_seconds - fast_seek_seconds).max(0.0);
    (
        format!("{fast_seek_seconds:.3}"),
        format!("{accurate_offset_seconds:.3}"),
    )
}

fn bucket_position(position: FallbackFramePosition, quality: FallbackFrameQuality) -> String {
    match position {
        FallbackFramePosition::Percent(raw) => {
            let clamped = raw.clamp(0.0, 100.0);
            let step = match quality {
                FallbackFrameQuality::Low => 2.0,
                FallbackFrameQuality::High => 1.0,
            };
            let snapped = (clamped / step).round() * step;
            let as_int = snapped.round().clamp(0.0, 100.0) as i32;
            format!("p{as_int:03}")
        }
        FallbackFramePosition::Seconds(raw) => {
            let clamped = raw.max(0.0);
            let step = match quality {
                // Compare scrubbing uses low-quality frames while moving the slider and expects
                // reasonably tight alignment; keep caching granular enough to avoid "wrong frame"
                // reports for long GOP sources.
                FallbackFrameQuality::Low => 0.2,
                FallbackFrameQuality::High => 0.1,
            };
            let snapped = (clamped / step).round() * step;
            let as_ms = (snapped * 1000.0).round().max(0.0) as u64;
            format!("s{as_ms}")
        }
    }
}

fn detect_duration_seconds_with_ffprobe(path: &Path, tools: &ExternalToolSettings) -> Result<f64> {
    let (ffprobe_path, _, _) = ensure_tool_available(ExternalToolKind::Ffprobe, tools)?;
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
    Ok(first.parse().unwrap_or(0.0))
}

fn acquire_inflight_lock(key: &str) -> Arc<Mutex<()>> {
    let mut map = INFLIGHT_LOCKS.lock_unpoisoned();
    map.entry(key.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
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

    match quality {
        FallbackFrameQuality::Low => {
            out.push("-vf".into());
            out.push(LOW_QUALITY_FRAME_VF.into());
            out.push("-q:v".into());
            out.push("10".into());
        }
        FallbackFrameQuality::High => {
            out.push("-vf".into());
            out.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".into());
            out.push("-q:v".into());
            out.push("2".into());
        }
    }

    out.push("-f".into());
    out.push("image2".into());
    out.push("-c:v".into());
    out.push("mjpeg".into());
    out.push("-pix_fmt".into());
    out.push("yuvj420p".into());
    out.push("-strict".into());
    out.push("-1".into());
    out.push(tmp_path.as_os_str().to_os_string());

    out
}

fn move_tmp_to_final(tmp_path: &Path, final_path: &Path) -> Result<()> {
    fs::rename(tmp_path, final_path).or_else(|_| {
        fs::copy(tmp_path, final_path)
            .map(|_| ())
            .and_then(|_| fs::remove_file(tmp_path))
    })?;
    Ok(())
}

fn extract_frame_with_seek_backoffs<F>(
    base_seek_seconds: f64,
    seek_backoffs_seconds: &[f64],
    tmp_path: &Path,
    final_path: &Path,
    mut run_ffmpeg: F,
) -> Result<f64>
where
    F: FnMut(f64, &Path) -> Result<()>, {
    let mut last_error: Option<anyhow::Error> = None;
    for offset in seek_backoffs_seconds {
        let attempt_seek_seconds = (base_seek_seconds - offset).max(0.0);
        let _ = fs::remove_file(tmp_path);

        match run_ffmpeg(attempt_seek_seconds, tmp_path) {
            Ok(()) => {}
            Err(err) => {
                last_error = Some(err);
                continue;
            }
        }

        if !is_non_empty_regular_file(tmp_path) {
            last_error = Some(anyhow::anyhow!(
                "ffmpeg reported success but wrote no frame output (seekSeconds={attempt_seek_seconds:.3})"
            ));
            continue;
        }

        move_tmp_to_final(tmp_path, final_path)?;
        return Ok(attempt_seek_seconds);
    }

    let _ = fs::remove_file(tmp_path);
    Err(last_error
        .unwrap_or_else(|| anyhow::anyhow!("ffmpeg did not produce a preview frame output")))
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
    ensure_dir_exists(&frames_dir)?;

    let final_path = frames_dir.join(format!("{hash:016x}.jpg"));
    if is_non_empty_regular_file(&final_path) {
        maybe_cleanup_cache_now(&cache_root);
        return Ok(final_path);
    }

    let inflight = acquire_inflight_lock(&key);
    let _guard = inflight.lock_unpoisoned();

    if is_non_empty_regular_file(&final_path) {
        maybe_cleanup_cache_now(&cache_root);
        return Ok(final_path);
    }

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

    let (ffmpeg_path, _, _) = ensure_tool_available(ExternalToolKind::Ffmpeg, tools)?;
    let tmp_path = frames_dir.join(frame_tmp_filename(hash));

    let _ = fs::remove_file(&final_path);

    let seek_seconds = clamp_seek_seconds(total_duration, requested_seconds);
    let seek_backoffs_seconds: [f64; 5] = [0.0, 0.25, 0.5, 1.0, 2.0];

    let _seek_used = extract_frame_with_seek_backoffs(
        seek_seconds,
        &seek_backoffs_seconds,
        &tmp_path,
        &final_path,
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

    maybe_cleanup_cache_now(&cache_root);
    Ok(final_path)
}

#[cfg(test)]
mod tests;
