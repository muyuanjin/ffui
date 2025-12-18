// ============================================================================
// Time utilities
// ============================================================================

pub(super) fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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

    let mut state = inner.state.lock().expect("engine state poisoned");
    let settings_ref = &mut state.settings;
    let tools = &mut settings_ref.tools;

    let downloaded = tools
        .downloaded
        .get_or_insert_with(DownloadedToolState::default);

    let (url, version, tag) = meta.unwrap_or_else(|| (String::new(), None, None));
    let info = DownloadedToolInfo {
        version: version.clone(),
        tag: tag.clone(),
        source_url: if url.is_empty() { None } else { Some(url.clone()) },
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
        eprintln!("failed to persist external tool download metadata to settings.json: {err:#}");
    }
}

// ============================================================================
// Batch Compress batch tracking
// ============================================================================

pub(super) fn mark_batch_compress_child_processed(inner: &Inner, job_id: &str) {
    let batch_id_opt = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get(job_id) {
            Some(job) => job.clone(),
            None => return,
        };

        let batch_id = match job.batch_id.clone() {
            Some(id) => id,
            None => return,
        };

        let batch = match state.batch_compress_batches.get_mut(&batch_id) {
            Some(b) => b,
            None => return,
        };

        // 仅在作业进入终态时增加 processed 计数。
        if !matches!(
            job.status,
            JobStatus::Completed | JobStatus::Skipped | JobStatus::Failed | JobStatus::Cancelled
        ) {
            return;
        }

        batch.total_processed = batch.total_processed.saturating_add(1);
        if batch.total_processed >= batch.total_candidates
            && !matches!(
                batch.status,
                BatchCompressBatchStatus::Completed | BatchCompressBatchStatus::Failed
            )
        {
            batch.status = BatchCompressBatchStatus::Completed;
            if batch.completed_at_ms.is_none() {
                batch.completed_at_ms = Some(current_time_millis());
            }
        }

        Some(batch_id)
    };

    if let Some(batch_id) = batch_id_opt {
        // 进度与状态已在上方锁内更新,这里仅负责广播最新快照。
        update_batch_compress_batch_with_inner(inner, &batch_id, true, |_batch| {});
    }
}
