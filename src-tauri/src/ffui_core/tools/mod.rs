mod candidates;
mod discover;
mod download;
mod probe;
mod resolve;
mod runtime_state;
mod status;
#[cfg(test)]
mod tests_async_refresh;
#[cfg(test)]
mod tests_manager;
#[cfg(test)]
mod tests_probe;
#[cfg(test)]
mod tests_runtime;
#[cfg(test)]
mod tests_runtime_clear_error;
#[cfg(test)]
mod tests_versioning;
mod types;

// Re-export API
pub(crate) use candidates::tool_candidates;
pub(crate) use download::{
    ensure_tool_available,
    force_download_tool_binary,
};
pub(crate) use probe::verify_tool_binary;
pub(crate) use runtime_state::{
    cached_ffmpeg_release_version,
    cached_libavif_release_version,
    cached_tool_status_snapshot,
    clear_tool_runtime_error,
    finish_tool_status_refresh,
    hydrate_last_tool_download_from_settings,
    hydrate_remote_version_cache_from_settings,
    last_tool_download_metadata,
    set_app_handle as set_tool_event_app_handle,
    try_begin_tool_status_refresh,
    ttl_hit,
    update_latest_status_snapshot,
};
pub(crate) use status::tool_status;
pub use types::{
    ExternalToolCandidate,
    ExternalToolKind,
    ExternalToolStatus,
};

pub(crate) fn hydrate_probe_cache_from_settings(
    settings: &crate::ffui_core::settings::ExternalToolSettings,
) {
    let Some(cache) = settings.probe_cache.as_ref() else {
        return;
    };

    fn seed(
        kind: ExternalToolKind,
        entry: &crate::ffui_core::settings::types::ExternalToolProbeCacheEntry,
    ) {
        let path = entry.path.trim();
        if path.is_empty() {
            return;
        }
        probe::seed_probe_cache_from_persisted(
            kind,
            path.to_string(),
            entry.ok,
            entry.version.clone(),
            entry.fingerprint.len,
            entry.fingerprint.modified_millis,
        );
    }

    if let Some(entry) = cache.ffmpeg.as_ref() {
        seed(ExternalToolKind::Ffmpeg, entry);
    }
    if let Some(entry) = cache.ffprobe.as_ref() {
        seed(ExternalToolKind::Ffprobe, entry);
    }
    if let Some(entry) = cache.avifenc.as_ref() {
        seed(ExternalToolKind::Avifenc, entry);
    }
}

pub(crate) fn update_probe_cache_from_statuses(
    tools: &mut crate::ffui_core::settings::ExternalToolSettings,
    statuses: &[ExternalToolStatus],
) -> bool {
    use std::time::{
        SystemTime,
        UNIX_EPOCH,
    };

    use crate::ffui_core::settings::types::{
        ExternalToolBinaryFingerprint,
        ExternalToolProbeCacheEntry,
    };

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX);

    let mut cache = tools.probe_cache.clone().unwrap_or_default();

    fn upsert(
        slot: &mut Option<ExternalToolProbeCacheEntry>,
        mut next: ExternalToolProbeCacheEntry,
        now_ms: u64,
    ) -> bool {
        if let Some(prev) = slot.as_ref()
            && prev.path == next.path
            && prev.fingerprint == next.fingerprint
            && prev.ok == next.ok
            && prev.version == next.version
        {
            next.checked_at_ms = prev.checked_at_ms;
            return false;
        }
        next.checked_at_ms = Some(now_ms);
        *slot = Some(next);
        true
    }

    let mut touched = false;
    for status in statuses {
        let Some(path) = status.resolved_path.as_deref() else {
            continue;
        };
        let Some(persistable) = probe::cached_probe_entry_for_persistence(status.kind, path) else {
            continue;
        };

        let entry = ExternalToolProbeCacheEntry {
            path: path.to_string(),
            fingerprint: ExternalToolBinaryFingerprint {
                len: persistable.fingerprint_len,
                modified_millis: persistable.fingerprint_modified_millis,
            },
            ok: persistable.ok,
            version: persistable.version,
            checked_at_ms: None,
        };

        let changed = match status.kind {
            ExternalToolKind::Ffmpeg => upsert(&mut cache.ffmpeg, entry, now_ms),
            ExternalToolKind::Ffprobe => upsert(&mut cache.ffprobe, entry, now_ms),
            ExternalToolKind::Avifenc => upsert(&mut cache.avifenc, entry, now_ms),
        };
        touched |= changed;
    }

    let cache = if cache.ffmpeg.is_none() && cache.ffprobe.is_none() && cache.avifenc.is_none() {
        None
    } else {
        Some(cache)
    };

    if tools.probe_cache != cache {
        tools.probe_cache = cache;
        return true;
    }

    touched
}

pub(crate) fn try_refresh_ffmpeg_static_release_from_github() -> Option<(String, String)> {
    let info = download::try_refresh_ffmpeg_release_from_github()?;
    Some((info.version, info.tag))
}

pub(crate) fn try_refresh_libavif_release_from_github() -> Option<(String, String)> {
    let info = download::try_refresh_libavif_release_from_github()?;
    Some((info.version, info.tag))
}

#[cfg(all(test, not(windows)))]
fn spawn_download_size_probe(
    kind: ExternalToolKind,
    tmp_path: std::path::PathBuf,
    total: Option<u64>,
) -> (
    std::sync::Arc<std::sync::atomic::AtomicBool>,
    std::thread::JoinHandle<()>,
) {
    let (stop, handle) = download::manager::spawn_download_size_probe(kind, tmp_path, total);
    let handle = handle.expect("progress probe thread should spawn in tests");
    (stop, handle)
}
