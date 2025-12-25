// ============================================================================
// Time utilities
// ============================================================================

pub(super) fn current_time_millis() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX)
}

// ============================================================================
// Tool download metadata tracking
// ============================================================================

pub(super) fn record_tool_download_with_inner(
    inner: &Inner,
    kind: ExternalToolKind,
    _binary_path: &str,
) {
    // Persist the last downloaded tool metadata (when available) into settings.json so that:
    // - the Settings panel can display human-readable version information;
    // - future runs can reuse persisted metadata for update hints.
    //
    // NOTE: We intentionally do not persist `tools.{ffmpeg,ffprobe,avifenc}_path` here.
    // Those fields represent user-provided "CUSTOM" overrides. Auto-downloaded binaries
    // are resolved via the tools directory on disk, so writing them into the custom path
    // would incorrectly auto-fill the Settings UI and change precedence semantics.
    let meta = last_tool_download_metadata(kind);

    let settings_snapshot = {
        let mut state = inner.state.lock_unpoisoned();
        let tools = &mut state.settings.tools;

        let downloaded = tools
            .downloaded
            .get_or_insert_with(DownloadedToolState::default);

        let (url, version, tag) = meta.unwrap_or_else(|| (String::new(), None, None));
        let info = DownloadedToolInfo {
            version,
            tag,
            source_url: if url.is_empty() { None } else { Some(url) },
            downloaded_at: Some(current_time_millis()),
        };

        match kind {
            ExternalToolKind::Ffmpeg => {
                downloaded.ffmpeg = Some(info);
            }
            ExternalToolKind::Ffprobe => {
                downloaded.ffprobe = Some(info);
            }
            ExternalToolKind::Avifenc => {
                downloaded.avifenc = Some(info);
            }
        }

        state.settings.clone()
    };

    if let Err(err) = crate::ffui_core::settings::save_settings(&settings_snapshot) {
        crate::debug_eprintln!(
            "failed to persist external tool download metadata to settings.json: {err:#}"
        );
    }
}

// ============================================================================
// Batch Compress batch tracking
// ============================================================================

pub(super) fn mark_batch_compress_child_processed(inner: &Inner, job_id: &str) {
    super::worker_utils::mark_batch_compress_child_processed(inner, job_id);
}
