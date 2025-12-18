use std::collections::HashMap;
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

use super::preview_cache::previews_root_dir_best_effort;
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

static INFLIGHT_LOCKS: Lazy<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[cfg(windows)]
fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn configure_background_command(_cmd: &mut Command) {}

fn compare_cache_root_dir() -> Result<PathBuf> {
    Ok(previews_root_dir_best_effort()?.join("compare-cache"))
}

fn compare_frames_dir() -> Result<PathBuf> {
    Ok(compare_cache_root_dir()?.join("frames"))
}

fn ensure_dir_exists(path: &Path) -> Result<()> {
    fs::create_dir_all(path)
        .with_context(|| format!("create_dir_all failed for {}", path.display()))
}

fn is_regular_file(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
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
    format!("{hash:016x}.part")
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
                FallbackFrameQuality::Low => 1.0,
                FallbackFrameQuality::High => 0.5,
            };
            let snapped = (clamped / step).round() * step;
            let as_ms = (snapped * 1000.0).round().max(0.0) as u64;
            format!("s{as_ms}")
        }
    }
}

fn acquire_inflight_lock(key: &str) -> Arc<Mutex<()>> {
    let mut map = INFLIGHT_LOCKS.lock().expect("inflight lock map poisoned");
    map.entry(key.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
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
    ensure_dir_exists(&frames_dir)?;

    let final_path = frames_dir.join(format!("{hash:016x}.jpg"));
    if is_regular_file(&final_path)
        && fs::metadata(&final_path)
            .map(|m| m.len() > 0)
            .unwrap_or(false)
    {
        maybe_cleanup_cache_now(&cache_root);
        return Ok(final_path);
    }

    let inflight = acquire_inflight_lock(&key);
    let _guard = inflight.lock().expect("inflight key lock poisoned");

    if is_regular_file(&final_path)
        && fs::metadata(&final_path)
            .map(|m| m.len() > 0)
            .unwrap_or(false)
    {
        maybe_cleanup_cache_now(&cache_root);
        return Ok(final_path);
    }

    let tmp_path = frames_dir.join(frame_tmp_filename(hash));
    let list_path = frames_dir.join(format!("{hash:016x}.concat.list"));
    let list_contents = build_concat_list_contents(&segments);
    fs::write(&list_path, list_contents.as_bytes())
        .with_context(|| format!("failed to write concat list {}", list_path.display()))?;

    let (ffmpeg_path, _, _) = ensure_tool_available(ExternalToolKind::Ffmpeg, tools)?;
    let mut cmd = Command::new(&ffmpeg_path);
    configure_background_command(&mut cmd);

    cmd.arg("-y")
        .arg("-v")
        .arg("error")
        .arg("-hide_banner")
        .arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(list_path.as_os_str())
        .arg("-ss")
        .arg(format!("{:.3}", position_seconds.max(0.0)))
        .arg("-frames:v")
        .arg("1");

    match quality {
        FallbackFrameQuality::Low => {
            cmd.arg("-vf").arg("scale=-2:360").arg("-q:v").arg("10");
        }
        FallbackFrameQuality::High => {
            cmd.arg("-q:v").arg("3");
        }
    }

    cmd.arg("-f")
        .arg("image2")
        .arg("-c:v")
        .arg("mjpeg")
        .arg(tmp_path.as_os_str());

    let output = cmd
        .output()
        .with_context(|| "failed to run ffmpeg concat frame extraction")?;

    if !output.status.success() {
        let _ = fs::remove_file(&tmp_path);
        let _ = fs::remove_file(&list_path);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow::anyhow!(
            "ffmpeg concat frame extraction failed with status {}: {}",
            output.status,
            stderr.trim()
        ));
    }

    let _ = fs::remove_file(&list_path);

    fs::rename(&tmp_path, &final_path).or_else(|_| {
        fs::copy(&tmp_path, &final_path)
            .map(|_| ())
            .and_then(|_| fs::remove_file(&tmp_path))
    })?;

    maybe_cleanup_cache_now(&cache_root);
    Ok(final_path)
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
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn concat_preview_reports_missing_segments_with_os_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("missing-seg0.mp4");
        let present = dir.path().join("seg1.mp4");
        fs::write(&present, b"x").expect("write present segment");

        let segs = vec![
            missing.to_string_lossy().into_owned(),
            present.to_string_lossy().into_owned(),
        ];

        let err = extract_concat_preview_frame(
            &segs,
            &ExternalToolSettings::default(),
            0.0,
            FallbackFrameQuality::Low,
        )
        .expect_err("should fail for missing segments");

        let msg = err.to_string();
        assert!(
            msg.contains("segmentPaths contains a non-readable file:"),
            "should include a stable error prefix: {msg}"
        );
        assert!(
            msg.contains("missing-seg0.mp4"),
            "should include the path: {msg}"
        );
        assert!(
            msg.contains("os error"),
            "should include OS error details: {msg}"
        );
    }
}
