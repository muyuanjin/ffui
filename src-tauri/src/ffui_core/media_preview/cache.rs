use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use anyhow::{Result, bail};

use super::super::preview_common::acquire_inflight_lock;

pub(super) fn lock(root: &Path) -> Arc<Mutex<()>> {
    acquire_inflight_lock(&format!("playback-cache:{}", root.display()))
}

fn owned(path: &Path) -> bool {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    stem.len() == 16
        && stem.bytes().all(|value| value.is_ascii_hexdigit())
        && matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("m4a" | "png")
        )
}

pub(super) fn reclaim(root: &Path, retained: Option<&Path>, budget: u64) -> Result<()> {
    let frames = root.join("frames");
    if !frames.exists() {
        return Ok(());
    }
    let mut entries: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    let now = SystemTime::now();
    for entry in fs::read_dir(frames)? {
        let entry = entry?;
        let path = entry.path();
        if !owned(&path) || !entry.file_type()?.is_file() {
            continue;
        }
        let metadata = entry.metadata()?;
        let modified = metadata.modified()?;
        let expired = now.duration_since(modified).unwrap_or_default()
            > Duration::from_secs(7 * 24 * 60 * 60);
        if retained != Some(path.as_path()) && expired && fs::remove_file(&path).is_ok() {
            continue;
        }
        entries.push((path, metadata.len(), modified));
    }
    let mut total: u64 = entries.iter().map(|(_, size, _)| size).sum();
    entries.sort_by_key(|(_, _, modified)| *modified);
    for (path, size, _) in entries {
        if total <= budget {
            break;
        }
        if retained != Some(path.as_path()) && fs::remove_file(path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
    if total > budget {
        bail!("media preview cache capacity unavailable; close other previews or clear the cache");
    }
    Ok(())
}
