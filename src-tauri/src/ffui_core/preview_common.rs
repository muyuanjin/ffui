use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result};
use once_cell::sync::Lazy;

use super::FallbackFrameQuality;
use crate::sync_ext::MutexExt;

static INFLIGHT_LOCKS: Lazy<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const DEFAULT_PREVIEW_CACHE_CLEANUP_THROTTLE: Duration = Duration::from_secs(120);

const DEFAULT_COMPARE_CACHE_MAX_BYTES: u64 = 512 * 1024 * 1024; // 512 MiB
const DEFAULT_COMPARE_CACHE_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60); // 30 days
static COMPARE_LAST_CLEANUP_AT: Lazy<Mutex<Option<SystemTime>>> = Lazy::new(|| Mutex::new(None));

const DEFAULT_FALLBACK_CACHE_MAX_BYTES: u64 = 1024 * 1024 * 1024; // 1 GiB
const DEFAULT_FALLBACK_CACHE_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60); // 30 days
static FALLBACK_LAST_CLEANUP_AT: Lazy<Mutex<Option<SystemTime>>> = Lazy::new(|| Mutex::new(None));

#[cfg(windows)]
pub(crate) fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
pub(crate) fn configure_background_command(_cmd: &mut Command) {}

pub(crate) fn acquire_inflight_lock(key: &str) -> Arc<Mutex<()>> {
    let mut map = INFLIGHT_LOCKS.lock_unpoisoned();
    map.entry(key.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

pub(crate) fn maybe_cleanup_compare_cache_now(cache_root: &Path) {
    maybe_cleanup_frames_cache_now(
        &COMPARE_LAST_CLEANUP_AT,
        DEFAULT_PREVIEW_CACHE_CLEANUP_THROTTLE,
        cache_root,
        DEFAULT_COMPARE_CACHE_MAX_BYTES,
        Some(DEFAULT_COMPARE_CACHE_TTL),
        "compare cache",
    );
}

pub(crate) fn maybe_cleanup_fallback_cache_now(cache_root: &Path) {
    maybe_cleanup_frames_cache_now(
        &FALLBACK_LAST_CLEANUP_AT,
        DEFAULT_PREVIEW_CACHE_CLEANUP_THROTTLE,
        cache_root,
        DEFAULT_FALLBACK_CACHE_MAX_BYTES,
        Some(DEFAULT_FALLBACK_CACHE_TTL),
        "fallback cache",
    );
}

pub(crate) fn ensure_dir_exists(path: &Path) -> Result<()> {
    fs::create_dir_all(path)
        .with_context(|| format!("create_dir_all failed for {}", path.display()))
}

pub(crate) fn is_regular_file(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

pub(crate) fn is_non_empty_regular_file(path: &Path) -> bool {
    is_regular_file(path) && fs::metadata(path).map(|m| m.len() > 0).unwrap_or(false)
}

pub(crate) fn file_fingerprint(path: &Path) -> (u64, Option<u128>) {
    let Ok(meta) = fs::metadata(path) else {
        return (0, None);
    };
    let len = meta.len();
    let modified_ms = meta.modified().ok().and_then(|t| {
        t.duration_since(SystemTime::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_millis())
    });
    (len, modified_ms)
}

pub(crate) fn hash_key(parts: &[&str]) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    for part in parts {
        part.hash(&mut hasher);
    }
    hasher.finish()
}

pub(crate) fn frame_tmp_filename(hash: u64) -> String {
    format!("{hash:016x}.part")
}

pub(crate) fn two_stage_seek_args(seek_seconds: f64) -> (String, String) {
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

pub(crate) fn move_tmp_to_final(tmp_path: &Path, final_path: &Path) -> Result<()> {
    fs::rename(tmp_path, final_path).or_else(|_| {
        fs::copy(tmp_path, final_path)
            .map(|_| ())
            .and_then(|()| fs::remove_file(tmp_path))
    })?;
    Ok(())
}

pub(crate) fn extract_frame_with_seek_backoffs<F>(
    base_seek_seconds: f64,
    seek_backoffs_seconds: &[f64],
    tmp_path: &Path,
    final_path: &Path,
    final_error_message: &str,
    mut run_ffmpeg: F,
) -> Result<f64>
where
    F: FnMut(f64, &Path) -> Result<()>,
{
    let mut last_error: Option<anyhow::Error> = None;
    for offset in seek_backoffs_seconds {
        let attempt_seconds = (base_seek_seconds - offset).max(0.0);
        let _ = fs::remove_file(tmp_path);

        match run_ffmpeg(attempt_seconds, tmp_path) {
            Ok(()) => {}
            Err(err) => {
                last_error = Some(err);
                continue;
            }
        }

        if !is_non_empty_regular_file(tmp_path) {
            last_error = Some(anyhow::anyhow!(
                "ffmpeg reported success but wrote no frame output (seekSeconds={attempt_seconds:.3})"
            ));
            continue;
        }

        move_tmp_to_final(tmp_path, final_path)?;
        return Ok(attempt_seconds);
    }

    let _ = fs::remove_file(tmp_path);
    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("{final_error_message}")))
}

pub(crate) fn bucket_percent_position(raw: f64, quality: FallbackFrameQuality) -> String {
    let clamped = raw.clamp(0.0, 100.0);
    let step = match quality {
        FallbackFrameQuality::Low => 2.0,
        FallbackFrameQuality::High => 1.0,
    };
    let snapped = (clamped / step).round() * step;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let as_int = snapped.round().clamp(0.0, 100.0) as i32;
    format!("p{as_int:03}")
}

pub(crate) fn bucket_seconds_position(raw: f64, step: f64) -> String {
    let clamped = raw.max(0.0);
    let snapped = if step.is_finite() && step > 0.0 {
        (clamped / step).round() * step
    } else {
        clamped
    };
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let as_ms = (snapped * 1000.0).round().max(0.0) as u64;
    format!("s{as_ms}")
}

pub(crate) fn append_preview_frame_jpeg_args(
    out: &mut Vec<OsString>,
    quality: FallbackFrameQuality,
    high_quality_q: &'static str,
) {
    match quality {
        FallbackFrameQuality::Low => {
            out.push("-vf".into());
            out.push("scale=-2:360".into());
            out.push("-q:v".into());
            out.push("10".into());
        }
        FallbackFrameQuality::High => {
            out.push("-vf".into());
            out.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".into());
            out.push("-q:v".into());
            out.push(high_quality_q.into());
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
}

pub(crate) fn with_cached_preview_frame<F>(
    key: &str,
    frames_dir: &Path,
    cache_root: &Path,
    hash: u64,
    maybe_cleanup: impl FnOnce(&Path),
    run: F,
) -> Result<PathBuf>
where
    F: FnOnce(&Path, &Path) -> Result<()>,
{
    ensure_dir_exists(frames_dir)?;

    let final_path = frames_dir.join(format!("{hash:016x}.jpg"));
    if is_non_empty_regular_file(&final_path) {
        maybe_cleanup(cache_root);
        return Ok(final_path);
    }

    let inflight = acquire_inflight_lock(key);
    let _guard = inflight.lock_unpoisoned();

    if is_non_empty_regular_file(&final_path) {
        maybe_cleanup(cache_root);
        return Ok(final_path);
    }

    let tmp_path = frames_dir.join(frame_tmp_filename(hash));
    run(&tmp_path, &final_path)?;
    maybe_cleanup(cache_root);
    Ok(final_path)
}

pub(crate) fn maybe_cleanup_frames_cache_now(
    last_cleanup_at: &Mutex<Option<SystemTime>>,
    cleanup_throttle: Duration,
    cache_root: &Path,
    max_total_bytes: u64,
    ttl: Option<Duration>,
    label: &str,
) {
    let now = SystemTime::now();

    {
        let mut last = last_cleanup_at.lock_unpoisoned();
        if let Some(prev) = *last
            && now.duration_since(prev).unwrap_or_default() < cleanup_throttle
        {
            return;
        }
        *last = Some(now);
    }

    if let Err(err) = cleanup_frames_cache(cache_root, max_total_bytes, ttl) {
        crate::debug_eprintln!("{label} cleanup failed: {err:#}");
    }
}

pub(crate) fn cleanup_frames_cache(
    cache_root: &Path,
    max_total_bytes: u64,
    ttl: Option<Duration>,
) -> Result<()> {
    let mut entries: Vec<(PathBuf, u64, SystemTime)> = Vec::new();

    for sub in ["frames"] {
        let dir = cache_root.join(sub);
        if !dir.exists() {
            continue;
        }

        for entry in
            fs::read_dir(&dir).with_context(|| format!("read_dir failed for {}", dir.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            if !is_regular_file(&path) {
                continue;
            }

            let Ok(meta) = entry.metadata() else {
                continue;
            };

            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            let size = meta.len();
            entries.push((path, size, modified));
        }
    }

    let now = SystemTime::now();

    if let Some(ttl) = ttl {
        for (path, _, modified) in &entries {
            if now.duration_since(*modified).unwrap_or_default() > ttl {
                let _ = fs::remove_file(path);
            }
        }
        entries.retain(|(path, _, _)| is_regular_file(path));
    }

    let mut total: u64 = entries.iter().map(|(_, size, _)| *size).sum();
    if total <= max_total_bytes {
        return Ok(());
    }

    entries.sort_by_key(|(_, _, modified)| *modified);

    for (path, size, _) in entries {
        if total <= max_total_bytes {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }

    Ok(())
}
