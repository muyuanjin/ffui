use std::fs;
use std::path::{
    Path,
    PathBuf,
};
use std::sync::Mutex;
use std::time::{
    Duration,
    SystemTime,
};

use anyhow::{
    Context,
    Result,
};
use once_cell::sync::Lazy;

use crate::sync_ext::MutexExt;

const DEFAULT_FALLBACK_CACHE_MAX_BYTES: u64 = 1024 * 1024 * 1024; // 1 GiB
const DEFAULT_FALLBACK_CACHE_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60); // 30 days
const DEFAULT_CLEANUP_THROTTLE: Duration = Duration::from_secs(120);

static LAST_CLEANUP_AT: Lazy<Mutex<Option<SystemTime>>> = Lazy::new(|| Mutex::new(None));

pub(super) fn maybe_cleanup_cache_now(cache_root: &Path) {
    let now = SystemTime::now();

    {
        let mut last = LAST_CLEANUP_AT.lock_unpoisoned();
        if let Some(prev) = *last
            && now.duration_since(prev).unwrap_or_default() < DEFAULT_CLEANUP_THROTTLE
        {
            return;
        }
        *last = Some(now);
    }

    if let Err(err) = cleanup_fallback_cache(
        cache_root,
        DEFAULT_FALLBACK_CACHE_MAX_BYTES,
        Some(DEFAULT_FALLBACK_CACHE_TTL),
    ) {
        eprintln!("fallback cache cleanup failed: {err:#}");
    }
}

pub(crate) fn cleanup_fallback_cache(
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
            if !super::is_regular_file(&path) {
                continue;
            }

            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            let size = meta.len();
            entries.push((path, size, modified));
        }
    }

    let now = SystemTime::now();

    if let Some(ttl) = ttl {
        for (path, _, modified) in entries.iter() {
            if now.duration_since(*modified).unwrap_or_default() > ttl {
                let _ = fs::remove_file(path);
            }
        }
        entries.retain(|(path, _, _)| super::is_regular_file(path));
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
