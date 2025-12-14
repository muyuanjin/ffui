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
pub(crate) use download::{ensure_tool_available, force_download_tool_binary};
pub(crate) use probe::verify_tool_binary;
pub(crate) use runtime_state::{
    clear_tool_runtime_error, hydrate_last_tool_download_from_settings,
    hydrate_remote_version_cache_from_settings, last_tool_download_metadata,
    set_app_handle as set_tool_event_app_handle, update_latest_status_snapshot,
};
pub(crate) use status::tool_status;
pub use types::{ExternalToolCandidate, ExternalToolKind, ExternalToolStatus};

pub(crate) use runtime_state::{
    cached_ffmpeg_release_version, cached_libavif_release_version, cached_tool_status_snapshot,
    finish_tool_status_refresh, try_begin_tool_status_refresh, ttl_hit,
};

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
    download::manager::spawn_download_size_probe(kind, tmp_path, total)
}
