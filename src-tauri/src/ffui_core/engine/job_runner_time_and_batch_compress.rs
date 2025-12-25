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
    binary_path: &str,
) {
    // Persist the last downloaded tool metadata (when available) together
    // with the concrete binary path into settings.json so that:
    // - the Settings panel can display human-readable version information;
    // - future runs prefer the known-good binary instead of relying on PATH.
    //
    // When no metadata has been recorded yet (for example in certain manual
    // test setups), we still update the path and create a minimal
    // DownloadedToolInfo entry so the UI and engine have a single source of
    // truth.
    let meta = last_tool_download_metadata(kind);

    let mut state = inner.state.lock_unpoisoned();
    let settings_ref = &mut state.settings;
    let tools = &mut settings_ref.tools;

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
            // Prefer the auto-downloaded (or manually-triggered) binary for
            // future invocations.
            tools.ffmpeg_path = Some(binary_path.to_string());
        }
        ExternalToolKind::Ffprobe => {
            downloaded.ffprobe = Some(info);
            tools.ffprobe_path = Some(binary_path.to_string());
        }
        ExternalToolKind::Avifenc => {
            downloaded.avifenc = Some(info);
            tools.avifenc_path = Some(binary_path.to_string());
        }
    }

    if let Err(err) = crate::ffui_core::settings::save_settings(settings_ref) {
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
