use super::{AppSettings, Result, TranscodingEngine, settings, state, worker};
use crate::ffui_core::tools::{ExternalToolKind, clear_tool_runtime_error};
use crate::sync_ext::MutexExt;

impl super::state::Inner {
    #[cfg(test)]
    pub(crate) fn persist_current_settings(&self) -> Result<()> {
        self.update_settings(|_| ())?;
        Ok(())
    }

    pub(crate) fn update_settings<Output>(
        &self,
        update: impl FnOnce(&mut AppSettings) -> Output,
    ) -> Result<Output> {
        let _guard = self.settings_persistence.lock_unpoisoned();
        let mut store = self.settings_store.lock_unpoisoned();
        if store.is_none() {
            *store = Some(settings::SettingsStore::open()?);
        }
        let mut state = self.state.lock_unpoisoned();
        if let Some(error) = &state.settings_load_error {
            anyhow::bail!("Settings are not loaded: {error}");
        }
        let mut candidate = state.settings.clone();
        let output = update(&mut candidate);
        let snapshot = store
            .as_mut()
            .expect("settings store loaded")
            .update(&candidate)?;
        if state.settings.preview_capture_percent != snapshot.settings.preview_capture_percent {
            state.preview_refresh_token = state.preview_refresh_token.saturating_add(1);
            for job in state
                .jobs
                .values_mut()
                .filter(|job| job.job_type == crate::ffui_core::domain::JobType::Video)
            {
                job.preview_path = None;
                job.preview_revision = job.preview_revision.saturating_add(1);
            }
        }
        let tools_changed = state.settings.tools.ffmpeg_path != snapshot.settings.tools.ffmpeg_path
            || state.settings.tools.ffprobe_path != snapshot.settings.tools.ffprobe_path
            || state.settings.tools.avifenc_path != snapshot.settings.tools.avifenc_path
            || state.settings.tools.auto_download != snapshot.settings.tools.auto_download
            || state.settings.tools.auto_update != snapshot.settings.tools.auto_update;
        state.settings = snapshot.settings;
        state.unavailable_settings = snapshot.unavailable_settings;
        let tools = state.settings.tools.clone();
        let proxy = state.settings.network_proxy.clone();
        let proxy_error = state.settings_capability_error(&["/networkProxy"]);
        drop(state);
        drop(store);
        install_runtime_tool_state(&tools);
        crate::ffui_core::network_proxy::apply_confirmed_settings(proxy.as_ref(), proxy_error);
        if tools_changed {
            clear_runtime_tool_errors();
        }
        self.cv.notify_all();
        state::notify_queue_listeners(self);
        Ok(output)
    }
}

#[cfg(test)]
mod persistence_tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn queued_settings_persistence_reads_the_latest_state_after_acquiring_ownership() {
        let directory = tempfile::tempdir().expect("directory");
        let _data_root =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(directory.path().into());
        let inner = Arc::new(super::super::state::Inner::new(
            Vec::new(),
            AppSettings::default(),
        ));
        inner
            .state
            .lock_unpoisoned()
            .settings
            .default_queue_preset_id = Some("audio".into());
        let guard = inner.settings_persistence.lock_unpoisoned();
        let pending = Arc::clone(&inner);
        let worker = std::thread::spawn(move || pending.persist_current_settings());
        inner
            .state
            .lock_unpoisoned()
            .settings
            .default_queue_preset_id = Some("video".into());
        drop(guard);
        worker
            .join()
            .expect("worker")
            .expect("save latest settings");
        let saved = settings::load_settings().expect("load settings");
        assert_eq!(saved.default_queue_preset_id.as_deref(), Some("video"));
        assert!(
            !directory
                .path()
                .join("ffui.settings.last-good.json")
                .exists()
        );
    }
}

#[cfg(test)]
fn merge_backend_owned_tool_state(
    new_tools: &mut crate::ffui_core::settings::ExternalToolSettings,
    old_tools: &crate::ffui_core::settings::ExternalToolSettings,
) {
    if new_tools.downloaded.is_none() {
        new_tools.downloaded.clone_from(&old_tools.downloaded);
    }
    if new_tools.remote_version_cache.is_none() {
        new_tools
            .remote_version_cache
            .clone_from(&old_tools.remote_version_cache);
    }
    if new_tools.probe_cache.is_none() {
        new_tools.probe_cache.clone_from(&old_tools.probe_cache);
    }
}

impl TranscodingEngine {
    #[cfg(test)]
    pub fn checked_settings(&self) -> Result<AppSettings> {
        let snapshot = self.settings_snapshot()?;
        if let Some(error) = snapshot
            .unavailable_settings
            .iter()
            .find(|entry| entry.path.is_empty())
        {
            anyhow::bail!("{}", error.reason);
        }
        Ok(snapshot.settings)
    }

    pub fn settings_snapshot(&self) -> Result<settings::SettingsSnapshot> {
        let _guard = self.inner.settings_persistence.lock_unpoisoned();
        let mut store = self.inner.settings_store.lock_unpoisoned();
        if store.is_none() {
            *store = Some(settings::SettingsStore::open()?);
        }
        let snapshot = match store.as_mut().expect("settings store loaded").reload() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                self.inner.state.lock_unpoisoned().settings_load_error = Some(format!("{error:#}"));
                return Err(error);
            }
        };
        drop(store);
        self.inner.state.lock_unpoisoned().settings_load_error = None;
        Ok(self.publish_settings(snapshot))
    }

    /// Save new application settings.
    #[cfg(test)]
    pub fn save_settings(&self, new_settings: AppSettings) -> Result<AppSettings> {
        let baseline = self.settings_snapshot()?;
        let mut next = new_settings;
        merge_backend_owned_tool_state(&mut next.tools, &baseline.settings.tools);
        Ok(self
            .commit_settings(
                next,
                baseline.settings,
                baseline.content_id,
                baseline.data_root_id,
                false,
            )?
            .settings)
    }

    pub fn commit_settings(
        &self,
        new_settings: AppSettings,
        base_settings: AppSettings,
        base_content_id: String,
        data_root_id: String,
        user_owned: bool,
    ) -> Result<settings::SettingsSnapshot> {
        let _guard = self.inner.settings_persistence.lock_unpoisoned();
        let mut store = self.inner.settings_store.lock_unpoisoned();
        if store.is_none() {
            *store = Some(settings::SettingsStore::open()?);
        }
        if let Some(error) = &self.inner.state.lock_unpoisoned().settings_load_error {
            anyhow::bail!("Settings are not loaded: {error}");
        }
        let saved = store.as_mut().expect("settings store loaded").commit(
            &base_settings,
            &base_content_id,
            &data_root_id,
            &new_settings,
            user_owned,
        )?;
        drop(store);
        Ok(self.publish_settings(saved))
    }

    pub fn settings_document(&self) -> Result<serde_json::Value> {
        self.settings_snapshot()?;
        let _guard = self.inner.settings_persistence.lock_unpoisoned();
        let store = self.inner.settings_store.lock_unpoisoned();
        Ok(store.as_ref().expect("settings store loaded").document())
    }

    pub fn import_settings_document(
        &self,
        document: serde_json::Value,
    ) -> Result<settings::SettingsSnapshot> {
        self.settings_snapshot()?;
        let _guard = self.inner.settings_persistence.lock_unpoisoned();
        let mut store = self.inner.settings_store.lock_unpoisoned();
        let saved = store
            .as_mut()
            .expect("settings store loaded")
            .import_document(document)?;
        drop(store);
        Ok(self.publish_settings(saved))
    }

    pub fn reset_settings(&self) -> Result<settings::SettingsSnapshot> {
        let _guard = self.inner.settings_persistence.lock_unpoisoned();
        let reset = settings::SettingsStore::reset()?;
        let saved = reset.snapshot();
        *self.inner.settings_store.lock_unpoisoned() = Some(reset);
        self.inner.state.lock_unpoisoned().settings_load_error = None;
        Ok(self.publish_settings(saved))
    }

    fn publish_settings(&self, saved: settings::SettingsSnapshot) -> settings::SettingsSnapshot {
        let (
            tools_changed,
            percent_changed,
            proxy_error,
            refresh_token,
            tools_snapshot,
            new_percent,
            proxy_snapshot,
            saved,
        ) = {
            let mut state = self.inner.state.lock_unpoisoned();

            let old_tools = state.settings.tools.clone();
            let old_percent = state.settings.preview_capture_percent;

            state.settings = saved.settings.clone();
            state.unavailable_settings = saved.unavailable_settings.clone();

            let new_tools = &state.settings.tools;
            let tools_changed = old_tools.ffmpeg_path != new_tools.ffmpeg_path
                || old_tools.ffprobe_path != new_tools.ffprobe_path
                || old_tools.avifenc_path != new_tools.avifenc_path
                || old_tools.auto_download != new_tools.auto_download
                || old_tools.auto_update != new_tools.auto_update;

            let new_percent = state.settings.preview_capture_percent;
            let percent_changed = old_percent != new_percent;
            let proxy_snapshot = state.settings.network_proxy.clone();
            let proxy_error = state.settings_capability_error(&["/networkProxy"]);

            if percent_changed {
                state.preview_refresh_token = state.preview_refresh_token.saturating_add(1);
            }
            let refresh_token = state.preview_refresh_token;

            (
                tools_changed,
                percent_changed,
                proxy_error,
                refresh_token,
                state.settings.tools.clone(),
                new_percent,
                proxy_snapshot,
                saved,
            )
        };

        if tools_changed {
            clear_runtime_tool_errors();
        }
        install_runtime_tool_state(&saved.settings.tools);

        crate::ffui_core::network_proxy::apply_confirmed_settings(
            proxy_snapshot.as_ref(),
            proxy_error,
        );

        if percent_changed {
            let engine_clone = self.clone();
            if let Err(err) = std::thread::Builder::new()
                .name(format!("ffui-preview-refresh-{new_percent}"))
                .spawn(move || {
                    engine_clone.refresh_video_previews_for_percent(
                        new_percent,
                        refresh_token,
                        &tools_snapshot,
                    );
                })
            {
                crate::debug_eprintln!("failed to spawn preview refresh thread: {err}");
            }
        }

        state::notify_queue_listeners(&self.inner);
        worker::spawn_worker(&self.inner);

        saved
    }
}

fn clear_runtime_tool_errors() {
    clear_tool_runtime_error(ExternalToolKind::Ffmpeg);
    clear_tool_runtime_error(ExternalToolKind::Ffprobe);
    clear_tool_runtime_error(ExternalToolKind::Avifenc);
}

fn install_runtime_tool_state(tools: &settings::ExternalToolSettings) {
    crate::ffui_core::tools::hydrate_last_tool_download_from_settings(tools);
    crate::ffui_core::tools::hydrate_remote_version_cache_from_settings(tools);
    crate::ffui_core::tools::hydrate_probe_cache_from_settings(tools);
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
