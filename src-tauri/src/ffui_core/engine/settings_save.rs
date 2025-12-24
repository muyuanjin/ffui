use super::*;
use crate::sync_ext::MutexExt;

fn merge_backend_owned_tool_state(
    new_tools: &mut crate::ffui_core::settings::ExternalToolSettings,
    old_tools: &crate::ffui_core::settings::ExternalToolSettings,
) {
    if new_tools.downloaded.is_none() {
        new_tools.downloaded = old_tools.downloaded.clone();
    }
    if new_tools.remote_version_cache.is_none() {
        new_tools.remote_version_cache = old_tools.remote_version_cache.clone();
    }
    if new_tools.probe_cache.is_none() {
        new_tools.probe_cache = old_tools.probe_cache.clone();
    }
}

impl TranscodingEngine {
    /// Save new application settings.
    pub fn save_settings(&self, new_settings: AppSettings) -> Result<AppSettings> {
        let (
            tools_changed,
            percent_changed,
            proxy_changed,
            refresh_token,
            tools_snapshot,
            new_percent,
            proxy_snapshot,
            saved,
        ) = {
            let mut state = self.inner.state.lock_unpoisoned();

            let mut normalized = new_settings.clone();
            normalized.normalize();

            let old_tools = state.settings.tools.clone();
            let old_percent = state.settings.preview_capture_percent;
            let old_proxy = state.settings.network_proxy.clone();

            // The frontend does not necessarily round-trip backend-owned cache
            // fields (for example tool probe/version fingerprints). Preserve
            // them when the incoming payload omits these fields so that
            // cross-session startup optimizations remain effective.
            merge_backend_owned_tool_state(&mut normalized.tools, &old_tools);

            state.settings = normalized.clone();
            settings::save_settings(&state.settings)?;

            let new_tools = &state.settings.tools;
            let tools_changed = old_tools.ffmpeg_path != new_tools.ffmpeg_path
                || old_tools.ffprobe_path != new_tools.ffprobe_path
                || old_tools.avifenc_path != new_tools.avifenc_path
                || old_tools.auto_download != new_tools.auto_download
                || old_tools.auto_update != new_tools.auto_update;

            let new_percent = state.settings.preview_capture_percent;
            let percent_changed = old_percent != new_percent;
            let proxy_snapshot = state.settings.network_proxy.clone();
            let proxy_changed = old_proxy != proxy_snapshot;

            let refresh_token = if percent_changed {
                state.preview_refresh_token = state.preview_refresh_token.saturating_add(1);
                state.preview_refresh_token
            } else {
                state.preview_refresh_token
            };

            (
                tools_changed,
                percent_changed,
                proxy_changed,
                refresh_token,
                state.settings.tools.clone(),
                new_percent,
                proxy_snapshot,
                normalized,
            )
        };

        if tools_changed {
            clear_tool_runtime_error(ExternalToolKind::Ffmpeg);
            clear_tool_runtime_error(ExternalToolKind::Ffprobe);
            clear_tool_runtime_error(ExternalToolKind::Avifenc);
        }

        if proxy_changed {
            crate::ffui_core::network_proxy::apply_settings(proxy_snapshot.as_ref());
        }

        if percent_changed {
            let engine_clone = self.clone();
            if let Err(err) = std::thread::Builder::new()
                .name(format!("ffui-preview-refresh-{new_percent}"))
                .spawn(move || {
                    engine_clone.refresh_video_previews_for_percent(
                        new_percent,
                        refresh_token,
                        tools_snapshot,
                    );
                })
            {
                crate::debug_eprintln!("failed to spawn preview refresh thread: {err}");
            }
        }

        state::notify_queue_listeners(&self.inner);
        worker::spawn_worker(self.inner.clone());

        Ok(saved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_backend_owned_tool_state_preserves_probe_cache_when_omitted() {
        use crate::ffui_core::settings::types::{
            ExternalToolBinaryFingerprint, ExternalToolProbeCache, ExternalToolProbeCacheEntry,
        };

        let old_tools = crate::ffui_core::settings::ExternalToolSettings {
            probe_cache: Some(ExternalToolProbeCache {
                ffmpeg: Some(ExternalToolProbeCacheEntry {
                    path: "C:/tools/ffmpeg.exe".to_string(),
                    fingerprint: ExternalToolBinaryFingerprint {
                        len: 123,
                        modified_millis: Some(456),
                    },
                    ok: true,
                    version: Some("ffmpeg version 9.9.9".to_string()),
                    checked_at_ms: Some(1_735_000_000_000),
                }),
                ffprobe: None,
                avifenc: None,
            }),
            ..Default::default()
        };

        let mut new_tools = crate::ffui_core::settings::ExternalToolSettings::default();
        merge_backend_owned_tool_state(&mut new_tools, &old_tools);

        assert_eq!(
            new_tools.probe_cache, old_tools.probe_cache,
            "probe_cache should be preserved when the new payload omits it"
        );
    }

    #[test]
    fn merge_backend_owned_tool_state_does_not_override_probe_cache_when_present() {
        use crate::ffui_core::settings::types::{
            ExternalToolBinaryFingerprint, ExternalToolProbeCache, ExternalToolProbeCacheEntry,
        };

        let old_tools = crate::ffui_core::settings::ExternalToolSettings {
            probe_cache: Some(ExternalToolProbeCache {
                ffmpeg: Some(ExternalToolProbeCacheEntry {
                    path: "C:/tools/old-ffmpeg.exe".to_string(),
                    fingerprint: ExternalToolBinaryFingerprint {
                        len: 1,
                        modified_millis: Some(2),
                    },
                    ok: true,
                    version: Some("ffmpeg version old".to_string()),
                    checked_at_ms: Some(1),
                }),
                ffprobe: None,
                avifenc: None,
            }),
            ..Default::default()
        };

        let mut new_tools = crate::ffui_core::settings::ExternalToolSettings {
            probe_cache: Some(ExternalToolProbeCache {
                ffmpeg: Some(ExternalToolProbeCacheEntry {
                    path: "C:/tools/new-ffmpeg.exe".to_string(),
                    fingerprint: ExternalToolBinaryFingerprint {
                        len: 9,
                        modified_millis: Some(9),
                    },
                    ok: true,
                    version: Some("ffmpeg version new".to_string()),
                    checked_at_ms: Some(9),
                }),
                ffprobe: None,
                avifenc: None,
            }),
            ..Default::default()
        };

        let expected = new_tools.probe_cache.clone();
        merge_backend_owned_tool_state(&mut new_tools, &old_tools);

        assert_eq!(
            new_tools.probe_cache, expected,
            "probe_cache should remain unchanged when the new payload already contains it"
        );
    }
}
