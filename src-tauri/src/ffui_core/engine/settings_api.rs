use super::*;

impl TranscodingEngine {
    /// Get the current application settings.
    pub fn settings(&self) -> AppSettings {
        let state = self.inner.state.lock().expect("engine state poisoned");
        state.settings.clone()
    }

    /// Save new application settings.
    pub fn save_settings(&self, new_settings: AppSettings) -> Result<AppSettings> {
        let (
            tools_changed,
            percent_changed,
            proxy_snapshot,
            proxy_changed,
            refresh_token,
            _tools_snapshot,
            new_percent,
            saved,
        ) = {
            let mut state = self.inner.state.lock().expect("engine state poisoned");

            let mut normalized = new_settings.clone();
            normalized.normalize();

            let old_tools = state.settings.tools.clone();
            let old_percent = state.settings.preview_capture_percent;
            let old_proxy = state.settings.network_proxy.clone();

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
                proxy_snapshot,
                proxy_changed,
                refresh_token,
                state.settings.tools.clone(),
                new_percent,
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
                    engine_clone.refresh_previews_after_setting_change(refresh_token, new_percent);
                })
            {
                eprintln!("failed to spawn preview refresh thread: {err:#}");
            }
        }

        Ok(saved)
    }
}

