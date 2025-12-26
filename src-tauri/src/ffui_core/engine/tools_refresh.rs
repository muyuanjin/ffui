use super::TranscodingEngine;
use crate::ffui_core::settings;
use crate::ffui_core::tools::{
    ExternalToolKind, ExternalToolStatus, ExternalToolUpdateCheckResult,
    cached_ffmpeg_release_version, cached_tool_status_snapshot, finish_tool_status_refresh,
    hydrate_remote_version_cache_from_settings, refresh_ffmpeg_static_release_from_github_checked,
    refresh_libavif_release_from_github_checked, try_begin_tool_status_refresh,
    try_refresh_ffmpeg_static_release_from_github, try_refresh_libavif_release_from_github,
    ttl_hit,
};
use crate::ffui_core::tools::{
    clear_tool_remote_check_state, record_tool_remote_check_error, record_tool_remote_check_message,
};
use crate::sync_ext::MutexExt;

type CheckedRemoteRefresh = fn() -> anyhow::Result<(String, String, Option<String>)>;
type BestEffortRemoteRefresh = fn() -> Option<(String, String)>;
type RemoteRefreshTuple = (Option<String>, Option<String>, Option<String>);

fn best_effort_remote_refresh(
    manual: bool,
    checked: CheckedRemoteRefresh,
    best_effort: BestEffortRemoteRefresh,
) -> anyhow::Result<RemoteRefreshTuple> {
    if manual {
        return checked().map(|(version, tag, note)| (Some(version), Some(tag), note));
    }
    Ok(best_effort().map_or((None, None, None), |(version, tag)| {
        (Some(version), Some(tag), None)
    }))
}

fn store_remote_version_cache<F>(engine: &TranscodingEngine, update: F)
where
    F: FnOnce(&mut crate::ffui_core::settings::types::RemoteToolVersionCache),
{
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let tools = &mut state.settings.tools;
        let cache = tools
            .remote_version_cache
            .get_or_insert_with(Default::default);
        update(cache);
    }
}

fn record_proxy_note_for_kinds(kinds: &[ExternalToolKind], note: &str, checked_at_ms: u64) {
    for kind in kinds.iter().copied() {
        record_tool_remote_check_message(kind, note.to_string(), checked_at_ms);
    }
}

fn record_proxy_remote_check_error(
    kinds: &[ExternalToolKind],
    err: &anyhow::Error,
    checked_at_ms: u64,
) {
    let msg = format!("[proxy] remote version check failed: {err:#}");
    for kind in kinds.iter().copied() {
        record_tool_remote_check_error(kind, msg.clone(), checked_at_ms);
    }
}

impl TranscodingEngine {
    /// Fast cached snapshot read for external tool statuses.
    ///
    /// This MUST NOT perform any blocking work (no network I/O, no spawning
    /// external processes). It is safe to call on the startup UI path.
    pub fn external_tool_statuses_cached(&self) -> Vec<ExternalToolStatus> {
        let tools = {
            let state = self.inner.state.lock_unpoisoned();
            state.settings.tools.clone()
        };
        hydrate_remote_version_cache_from_settings(&tools);
        let cached_remote = cached_ffmpeg_release_version();
        let cached_libavif = crate::ffui_core::tools::cached_libavif_release_version();

        // Best-effort: reuse the latest cached snapshot when available.
        let snapshot = cached_tool_status_snapshot();
        if !snapshot.is_empty() {
            return snapshot
                .into_iter()
                .map(|mut status| {
                    status.auto_download_enabled = tools.auto_download;
                    status.auto_update_enabled = tools.auto_update;
                    status
                })
                .collect();
        }

        // Fallback: emit a minimal placeholder snapshot so the UI can render
        // without waiting on heavy probing.
        vec![
            ExternalToolStatus {
                kind: ExternalToolKind::Ffmpeg,
                resolved_path: None,
                source: None,
                version: None,
                remote_version: cached_remote.clone(),
                update_check_result: ExternalToolUpdateCheckResult::Unknown,
                update_available: false,
                auto_download_enabled: tools.auto_download,
                auto_update_enabled: tools.auto_update,
                download_in_progress: false,
                download_progress: None,
                downloaded_bytes: None,
                total_bytes: None,
                bytes_per_second: None,
                last_download_error: None,
                last_download_message: None,
                last_remote_check_error: None,
                last_remote_check_message: None,
                last_remote_check_at_ms: None,
            },
            ExternalToolStatus {
                kind: ExternalToolKind::Ffprobe,
                resolved_path: None,
                source: None,
                version: None,
                remote_version: cached_remote,
                update_check_result: ExternalToolUpdateCheckResult::Unknown,
                update_available: false,
                auto_download_enabled: tools.auto_download,
                auto_update_enabled: tools.auto_update,
                download_in_progress: false,
                download_progress: None,
                downloaded_bytes: None,
                total_bytes: None,
                bytes_per_second: None,
                last_download_error: None,
                last_download_message: None,
                last_remote_check_error: None,
                last_remote_check_message: None,
                last_remote_check_at_ms: None,
            },
            ExternalToolStatus {
                kind: ExternalToolKind::Avifenc,
                resolved_path: None,
                source: None,
                version: None,
                remote_version: cached_libavif,
                update_check_result: ExternalToolUpdateCheckResult::Unknown,
                update_available: false,
                auto_download_enabled: tools.auto_download,
                auto_update_enabled: tools.auto_update,
                download_in_progress: false,
                download_progress: None,
                downloaded_bytes: None,
                total_bytes: None,
                bytes_per_second: None,
                last_download_error: None,
                last_download_message: None,
                last_remote_check_error: None,
                last_remote_check_message: None,
                last_remote_check_at_ms: None,
            },
        ]
    }

    /// Trigger an async external tool refresh (local probe + optional remote check).
    ///
    /// Returns true when a new refresh task was started; false when the request
    /// was deduped because a refresh is already in flight.
    pub fn refresh_external_tool_statuses_async(
        &self,
        remote_check: bool,
        manual_remote_check: bool,
        remote_check_kind: Option<ExternalToolKind>,
    ) -> bool {
        if !try_begin_tool_status_refresh() {
            crate::debug_eprintln!("[tools_refresh] dedupe hit (already in progress)");
            return false;
        }

        let engine_clone = self.clone();
        let spawned = std::thread::Builder::new()
            .name("ffui-tools-refresh".to_string())
            .spawn(move || {
                struct RefreshGuard;
                impl Drop for RefreshGuard {
                    fn drop(&mut self) {
                        finish_tool_status_refresh();
                    }
                }
                let _guard = RefreshGuard;

                use std::time::{Instant, SystemTime, UNIX_EPOCH};

                let started_at = Instant::now();
                let now_ms = u64::try_from(
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis(),
                )
                .unwrap_or(u64::MAX);

                let tools_settings = {
                    let state = engine_clone.inner.state.lock_unpoisoned();
                    state.settings.tools.clone()
                };

                // Seed in-process cache from persisted settings to avoid a network call on
                // the synchronous status code path.
                hydrate_remote_version_cache_from_settings(&tools_settings);

                const TTL_MS: u64 = 24 * 60 * 60 * 1000;
                let persisted = tools_settings
                    .remote_version_cache
                    .as_ref()
                    .and_then(|c| c.ffmpeg_static.as_ref());
                let remote_ttl_hit =
                    ttl_hit(now_ms, persisted.and_then(|info| info.checked_at_ms), TTL_MS);

                let persisted_libavif = tools_settings
                    .remote_version_cache
                    .as_ref()
                    .and_then(|c| c.libavif.as_ref());
                let libavif_ttl_hit =
                    ttl_hit(now_ms, persisted_libavif.and_then(|info| info.checked_at_ms), TTL_MS);

                let (should_check_ffmpeg, should_check_libavif) = match remote_check_kind {
                    Some(ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe) => {
                        (remote_check, false)
                    }
                    Some(ExternalToolKind::Avifenc) => (false, remote_check),
                    None => (
                        remote_check && (manual_remote_check || !remote_ttl_hit),
                        remote_check && (manual_remote_check || !libavif_ttl_hit),
                    ),
                };
                crate::debug_eprintln!(
                    "[tools_refresh] start remote_check={remote_check} manual={manual_remote_check} ttl_hit_ffmpeg={remote_ttl_hit} ttl_hit_libavif={libavif_ttl_hit}"
                );

                let mut remote_updated = false;
                let mut should_persist_settings = false;
                if manual_remote_check
                    && let Some(kind) = remote_check_kind {
                        clear_tool_remote_check_state(kind);
                    }
                if should_check_ffmpeg {
                    let refreshed = best_effort_remote_refresh(
                        manual_remote_check,
                        refresh_ffmpeg_static_release_from_github_checked,
                        try_refresh_ffmpeg_static_release_from_github,
                    );

                    match refreshed {
                        Ok((Some(version), Some(tag), note)) => {
                            remote_updated = true;
                            should_persist_settings = true;
                            store_remote_version_cache(&engine_clone, |cache| {
                                cache.ffmpeg_static = Some(
                                    crate::ffui_core::settings::types::RemoteToolVersionInfo {
                                        checked_at_ms: Some(now_ms),
                                        version: Some(version),
                                        tag: Some(tag),
                                    },
                                );
                            });

	                            if manual_remote_check && let Some(note) = note {
	                                let report_kinds: Vec<ExternalToolKind> = remote_check_kind
	                                    .map_or_else(
	                                        || {
	                                            vec![
	                                                ExternalToolKind::Ffmpeg,
	                                                ExternalToolKind::Ffprobe,
	                                            ]
	                                        },
	                                        |kind| vec![kind],
	                                    );
	                                record_proxy_note_for_kinds(&report_kinds, &note, now_ms);
	                            }
                        }
                        Ok((_v, _t, _note)) => {
                            crate::debug_eprintln!(
                                "[tools_refresh] ffmpeg remote version check failed (best-effort)"
                            );
                        }
		                        Err(err) => {
		                            let report_kinds: Vec<ExternalToolKind> = remote_check_kind
		                                .map_or_else(
		                                    || vec![ExternalToolKind::Ffmpeg, ExternalToolKind::Ffprobe],
		                                    |kind| vec![kind],
		                                );
		                            record_proxy_remote_check_error(&report_kinds, &err, now_ms);
		                        }
                    }
                }

                if should_check_libavif {
                    let refreshed = best_effort_remote_refresh(
                        manual_remote_check,
                        refresh_libavif_release_from_github_checked,
                        try_refresh_libavif_release_from_github,
                    );

                    match refreshed {
                        Ok((Some(version), Some(tag), note)) => {
                            remote_updated = true;
                            should_persist_settings = true;
                            store_remote_version_cache(&engine_clone, |cache| {
                                cache.libavif = Some(
                                    crate::ffui_core::settings::types::RemoteToolVersionInfo {
                                        checked_at_ms: Some(now_ms),
                                        version: Some(version),
                                        tag: Some(tag),
                                    },
                                );
                            });

	                            if manual_remote_check && let Some(note) = note {
	                                let report_kinds: Vec<ExternalToolKind> = remote_check_kind
	                                    .map_or_else(|| vec![ExternalToolKind::Avifenc], |kind| {
	                                        vec![kind]
	                                    });
	                                record_proxy_note_for_kinds(&report_kinds, &note, now_ms);
	                            }
                        }
                        Ok((_v, _t, _note)) => {
                            crate::debug_eprintln!(
                                "[tools_refresh] libavif remote version check failed (best-effort)"
                            );
                        }
		                        Err(err) => {
		                            let report_kinds: Vec<ExternalToolKind> = remote_check_kind
		                                .map_or_else(|| vec![ExternalToolKind::Avifenc], |kind| {
		                                    vec![kind]
		                                });
		                            record_proxy_remote_check_error(&report_kinds, &err, now_ms);
		                        }
                    }
                }

                if should_persist_settings {
                    let settings_snapshot = {
                        let state = engine_clone.inner.state.lock_unpoisoned();
                        state.settings.clone()
                    };
                    if let Err(err) = settings::save_settings(&settings_snapshot) {
                        crate::debug_eprintln!(
                            "[tools_refresh] failed to persist remote TTL cache: {err:#}"
                        );
                    }
                }

                // Always refresh local tool probing in the background, and push an event when
                // a full snapshot becomes available.
                engine_clone.external_tool_statuses();

                let elapsed_ms = started_at.elapsed().as_millis();
                crate::debug_eprintln!(
                    "[tools_refresh] done remote_updated={remote_updated} elapsed_ms={elapsed_ms}"
                );
            });

        if let Err(err) = spawned {
            finish_tool_status_refresh();
            crate::debug_eprintln!("[tools_refresh] failed to spawn refresh thread: {err}");
            return false;
        }

        true
    }
}
