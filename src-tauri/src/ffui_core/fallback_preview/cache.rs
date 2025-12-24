use std::path::Path;

use crate::ffui_core::preview_common::maybe_cleanup_fallback_cache_now;

pub(super) fn maybe_cleanup_cache_now(cache_root: &Path) {
    maybe_cleanup_fallback_cache_now(cache_root);
}

#[cfg(test)]
use std::time::Duration;

#[cfg(test)]
use anyhow::Result;

#[cfg(test)]
use crate::ffui_core::preview_common::cleanup_frames_cache;

#[cfg(test)]
pub(crate) fn cleanup_fallback_cache(
    cache_root: &Path,
    max_total_bytes: u64,
    ttl: Option<Duration>,
) -> Result<()> {
    cleanup_frames_cache(cache_root, max_total_bytes, ttl)
}
