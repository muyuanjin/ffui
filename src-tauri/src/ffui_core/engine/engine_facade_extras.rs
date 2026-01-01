use super::{TranscodingEngine, batch_compress, job_runner, transcode_activity};
use crate::ffui_core::domain::{AutoCompressResult, BatchCompressConfig};
use crate::ffui_core::settings;
use crate::ffui_core::tools::{
    ExternalToolKind, ExternalToolStatus, tool_status, update_probe_cache_from_statuses,
};
use crate::sync_ext::MutexExt;
use anyhow::Result;

impl TranscodingEngine {
    /// Persist metadata for a manually triggered external tool download.
    pub fn record_manual_tool_download(&self, kind: ExternalToolKind, binary_path: &str) {
        job_runner::record_tool_download_with_inner(&self.inner, kind, binary_path);
    }

    /// Get the status of all external tools.
    pub fn external_tool_statuses(&self) -> Vec<ExternalToolStatus> {
        // Snapshot tool settings while holding the engine lock, then perform any
        // filesystem/probing work outside the lock to avoid blocking other
        // startup commands and queue snapshots.
        let tools = {
            let state = self.inner.state.lock_unpoisoned();
            state.settings.tools.clone()
        };
        let statuses = vec![
            tool_status(ExternalToolKind::Ffmpeg, &tools),
            tool_status(ExternalToolKind::Ffprobe, &tools),
            tool_status(ExternalToolKind::Avifenc, &tools),
        ];

        // Cache a snapshot for event-based updates so the tools module can
        // emit ffui://external-tool-status without re-probing the filesystem
        // on every download tick.
        crate::ffui_core::tools::update_latest_status_snapshot(statuses.clone());
        let settings_to_persist = {
            let mut state = self.inner.state.lock_unpoisoned();
            if update_probe_cache_from_statuses(&mut state.settings.tools, &statuses) {
                Some(state.settings.clone())
            } else {
                None
            }
        };
        if let Some(settings_to_persist) = settings_to_persist
            && let Err(err) = settings::save_settings(&settings_to_persist)
        {
            crate::debug_eprintln!("[tools_probe_cache] failed to persist probe cache: {err:#}");
        }
        statuses
    }

    /// Get the Batch Compress default configuration.
    pub fn batch_compress_defaults(&self) -> BatchCompressConfig {
        let state = self.inner.state.lock_unpoisoned();
        state.settings.batch_compress_defaults.clone()
    }

    /// Update the Batch Compress default configuration.
    pub fn update_batch_compress_defaults(
        &self,
        config: BatchCompressConfig,
    ) -> Result<BatchCompressConfig> {
        let settings_snapshot = {
            let mut state = self.inner.state.lock_unpoisoned();
            state.settings.batch_compress_defaults = config.clone();
            state.settings.clone()
        };
        settings::save_settings(&settings_snapshot)?;
        Ok(config)
    }

    /// Run Batch Compress auto-compress on a directory.
    pub fn run_auto_compress(
        &self,
        root_path: String,
        config: BatchCompressConfig,
    ) -> Result<AutoCompressResult> {
        batch_compress::run_auto_compress(&self.inner, root_path, config)
    }

    /// Get the summary of a Batch Compress batch.
    #[cfg(test)]
    pub fn batch_compress_batch_summary(&self, batch_id: &str) -> Option<AutoCompressResult> {
        batch_compress::batch_compress_batch_summary(&self.inner, batch_id)
    }

    /// Inspect media file metadata using ffprobe.
    pub fn inspect_media(&self, path: &str) -> Result<String> {
        job_runner::inspect_media(&self.inner, path)
    }

    /// Return today's transcode activity buckets for the Monitor heatmap.
    pub fn transcode_activity_today(&self) -> crate::ffui_core::TranscodeActivityToday {
        transcode_activity::get_transcode_activity_today(&self.inner)
    }
}
