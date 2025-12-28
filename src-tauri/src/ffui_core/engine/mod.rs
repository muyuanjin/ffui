//! Transcoding engine split into modular components (`state`, `ffmpeg_args`, `worker`,
//! `job_runner`, `batch_compress`).
mod batch_compress;
#[cfg(feature = "bench")]
pub(super) mod bench;
mod enqueue_bulk;
mod ffmpeg_args;
mod file_times;
mod job_runner;
mod listeners;
mod os_paths;
mod output_policy_paths;
mod preview_cache_gc;
mod preview_refresh;
mod segment_discovery;
mod settings_save;
mod state;
mod state_persist;
mod template_args;
#[cfg(test)]
mod test_mutex;
#[cfg(test)]
mod tests;
mod tools_refresh;
mod transcode_activity;
mod ui_lite;
mod worker;
mod worker_utils;
pub(crate) use batch_compress::is_video_file;
#[cfg(test)]
pub(crate) use state_persist::lock_persist_test_mutex_for_tests;
#[cfg(test)]
pub(crate) use state_persist::override_queue_state_sidecar_path_for_tests;
// 导出 Job Object 初始化函数，供应用启动时调用
use crate::ffui_core::domain::{
    AutoCompressResult, BatchCompressConfig, FFmpegPreset, JobSource, JobType, OutputPolicy,
    QueueStartupHint, QueueState, QueueStateLite, TranscodeJob,
};
use crate::ffui_core::monitor::{
    CpuUsageSnapshot, GpuUsageSnapshot, sample_cpu_usage, sample_gpu_usage,
};
use crate::ffui_core::settings::{self, AppSettings};
use crate::ffui_core::tools::{
    ExternalToolKind, ExternalToolStatus, clear_tool_runtime_error,
    hydrate_last_tool_download_from_settings, hydrate_probe_cache_from_settings,
    hydrate_remote_version_cache_from_settings, tool_status, update_probe_cache_from_statuses,
};
use crate::ffui_core::{ShutdownMarkerKind, read_shutdown_marker, write_shutdown_marker};
use crate::sync_ext::MutexExt;
use anyhow::Result;
pub use ffmpeg_args::init_child_process_job;
use state::{
    Inner, restore_jobs_from_persisted_queue, snapshot_queue_state, snapshot_queue_state_lite,
};
use std::path::Path;
use std::sync::Arc;
/// The main transcoding engine facade.
#[derive(Clone)]
pub struct TranscodingEngine {
    pub(crate) inner: Arc<Inner>,
}

impl TranscodingEngine {
    /// Create a new transcoding engine instance.
    ///
    /// This loads presets and settings from disk, restores any persisted queue
    /// state in the background, and spawns worker threads to process jobs.
    pub fn new() -> Result<Self> {
        #[cfg(test)]
        let _guard = test_mutex::ENGINE_TEST_MUTEX.lock_unpoisoned();

        let presets = settings::load_presets().unwrap_or_default();
        let settings = settings::load_settings().unwrap_or_default();
        crate::ffui_core::network_proxy::apply_settings(settings.network_proxy.as_ref());
        hydrate_last_tool_download_from_settings(&settings.tools);
        hydrate_remote_version_cache_from_settings(&settings.tools);
        hydrate_probe_cache_from_settings(&settings.tools);
        let inner = Arc::new(Inner::new(presets, settings));
        {
            let previous = read_shutdown_marker();
            {
                let mut guard = inner.previous_shutdown_marker.lock_unpoisoned();
                *guard = previous;
            }
            write_shutdown_marker(ShutdownMarkerKind::Running);
        }
        {
            use std::sync::atomic::Ordering;
            use std::time::{SystemTime, UNIX_EPOCH};

            // If crash recovery is enabled, pre-bump the job id counter to a
            // high watermark so any new enqueues happening before the recovery
            // thread finishes cannot collide with persisted job ids.
            let state = inner.state.lock_unpoisoned();
            if matches!(
                state.settings.queue_persistence_mode,
                crate::ffui_core::settings::types::QueuePersistenceMode::CrashRecoveryLite
                    | crate::ffui_core::settings::types::QueuePersistenceMode::CrashRecoveryFull
            ) || state_persist::persisted_queue_state_exists_on_disk()
            {
                let baseline = u64::try_from(
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis(),
                )
                .unwrap_or(u64::MAX);
                inner.next_job_id.store(baseline.max(1), Ordering::Relaxed);
            }
        }
        {
            // Crash-recovery from the persisted queue state can involve heavy
            // disk I/O and JSON parsing if previous jobs carried large logs.
            // Run this on a dedicated background thread so application startup
            // is never blocked by queue deserialization.
            let inner_clone = inner.clone();
            let result = std::thread::Builder::new()
                .name("ffui-queue-recovery".to_string())
                .spawn(move || {
                    restore_jobs_from_persisted_queue(&inner_clone);
                    inner_clone
                        .queue_recovery_done
                        .store(true, std::sync::atomic::Ordering::Release);
                    inner_clone.cv.notify_all();
                })
                .map(|_| ());

            if let Err(err) = result {
                // Ensure callers waiting on crash recovery do not hang forever
                // if spawning the recovery worker fails.
                inner
                    .queue_recovery_done
                    .store(true, std::sync::atomic::Ordering::Release);
                inner.cv.notify_all();
                crate::debug_eprintln!("failed to spawn queue recovery thread: {err}");
            }
        }
        worker::spawn_worker(&inner);
        let engine = Self { inner };
        preview_cache_gc::spawn_preview_cache_gc(engine.clone());
        Ok(engine)
    }
    #[cfg(any(test, feature = "bench"))]
    pub(crate) fn new_for_tests() -> Self {
        let presets = Vec::new();
        let settings = AppSettings::default();
        let inner = Arc::new(Inner::new(presets, settings));
        Self { inner }
    }

    /// Get a snapshot of the current queue state.
    pub fn queue_state(&self) -> QueueState {
        snapshot_queue_state(&self.inner)
    }
    /// Get a lightweight snapshot of the current queue state for high-
    /// frequency updates and startup payloads.
    pub fn queue_state_lite(&self) -> QueueStateLite {
        snapshot_queue_state_lite(&self.inner)
    }

    /// Peek the startup hint without consuming it.
    ///
    /// The hint is cleared explicitly when the user resumes or dismisses the
    /// startup recovery prompt.
    pub fn queue_startup_hint(&self) -> Option<QueueStartupHint> {
        let guard = self.inner.queue_startup_hint.lock_unpoisoned();
        guard.clone()
    }

    pub fn clear_queue_startup_hint(&self) {
        let mut guard = self.inner.queue_startup_hint.lock_unpoisoned();
        *guard = None;
    }

    pub fn resume_startup_auto_paused_jobs(&self) -> usize {
        worker::resume_startup_auto_paused_jobs(&self.inner)
    }

    /// Force an immediate crash-recovery snapshot write (bypassing debounce).
    ///
    /// This is used by graceful shutdown paths that need wait metadata (segments,
    /// join targets, etc.) to be durable before the process exits.
    pub fn force_persist_queue_state_lite_now(&self) -> bool {
        let mode = {
            let state = self.inner.state.lock_unpoisoned();
            state.settings.queue_persistence_mode
        };

        let mut snapshot = self.queue_state_lite();

        if matches!(
            mode,
            crate::ffui_core::settings::types::QueuePersistenceMode::None
        ) {
            use crate::ffui_core::domain::JobStatus;
            snapshot.jobs.retain(|job| {
                matches!(
                    job.status,
                    JobStatus::Queued | JobStatus::Paused | JobStatus::Processing
                )
            });
        }

        state_persist::persist_queue_state_lite_immediate(&snapshot);
        true
    }
    /// Fetch full details for a single job from the in-memory engine state.
    pub fn job_detail(&self, job_id: &str) -> Option<TranscodeJob> {
        let state = self.inner.state.lock_unpoisoned();
        state.jobs.get(job_id).cloned()
    }
    /// Register a listener for queue state changes (test-only; production uses lightweight snapshots).
    #[cfg(test)]
    pub fn register_queue_listener<F>(&self, listener: F)
    where
        F: Fn(QueueState) + Send + Sync + 'static,
    {
        let mut listeners = self.inner.queue_listeners.lock_unpoisoned();
        listeners.push(Arc::new(listener));
    }
    /// Get the list of available presets.
    pub fn presets(&self) -> Arc<Vec<FFmpegPreset>> {
        let state = self.inner.state.lock_unpoisoned();
        state.presets.clone()
    }
    /// Save or update a preset.
    pub fn save_preset(&self, preset: FFmpegPreset) -> Result<Arc<Vec<FFmpegPreset>>> {
        let mut state = self.inner.state.lock_unpoisoned();
        let presets = Arc::make_mut(&mut state.presets);
        if let Some(existing) = presets.iter_mut().find(|p| p.id == preset.id) {
            *existing = preset;
        } else {
            presets.push(preset);
        }
        settings::save_presets(presets)?;
        Ok(state.presets.clone())
    }

    /// Replace the full preset list with the provided snapshot.
    pub fn replace_presets(&self, next: Vec<FFmpegPreset>) -> Result<Arc<Vec<FFmpegPreset>>> {
        let mut state = self.inner.state.lock_unpoisoned();
        state.presets = Arc::new(next);
        settings::save_presets(&state.presets)?;
        Ok(state.presets.clone())
    }

    /// Delete a preset by ID.
    pub fn delete_preset(&self, preset_id: &str) -> Result<Arc<Vec<FFmpegPreset>>> {
        let mut state = self.inner.state.lock_unpoisoned();
        let presets = Arc::make_mut(&mut state.presets);
        presets.retain(|p| p.id != preset_id);
        settings::save_presets(presets)?;
        Ok(state.presets.clone())
    }

    /// Reorder presets according to the provided list of IDs.
    ///
    /// The new order is determined by the `ordered_ids` slice. Any preset IDs
    /// not present in the slice are appended at the end in their original order.
    pub fn reorder_presets(&self, ordered_ids: &[String]) -> Result<Arc<Vec<FFmpegPreset>>> {
        let mut state = self.inner.state.lock_unpoisoned();
        let presets = Arc::make_mut(&mut state.presets);

        // Build index map for O(1) lookup
        let id_to_index: std::collections::HashMap<&str, usize> = ordered_ids
            .iter()
            .enumerate()
            .map(|(i, id)| (id.as_str(), i))
            .collect();

        // Sort presets: those in ordered_ids come first (in that order),
        // others are appended at the end preserving their relative order.
        let max_idx = ordered_ids.len();
        presets.sort_by(|a, b| {
            let idx_a = id_to_index.get(a.id.as_str()).copied().unwrap_or(max_idx);
            let idx_b = id_to_index.get(b.id.as_str()).copied().unwrap_or(max_idx);
            idx_a.cmp(&idx_b)
        });

        settings::save_presets(presets)?;
        Ok(state.presets.clone())
    }

    /// Get the current application settings.
    pub fn settings(&self) -> AppSettings {
        let state = self.inner.state.lock_unpoisoned();
        state.settings.clone()
    }

    /// Enqueue a new transcode job.
    pub fn enqueue_transcode_job(
        &self,
        filename: String,
        job_type: JobType,
        source: JobSource,
        original_size_mb: f64,
        original_codec: Option<String>,
        preset_id: String,
    ) -> TranscodeJob {
        worker::enqueue_transcode_job(
            &self.inner,
            filename,
            job_type,
            source,
            original_size_mb,
            original_codec,
            preset_id,
        )
    }

    pub fn preview_output_path(
        &self,
        input_path: &str,
        preset_id: Option<&str>,
        output_policy: &OutputPolicy,
    ) -> Option<String> {
        let trimmed = input_path.trim();
        if trimmed.is_empty() {
            return None;
        }
        let normalized = os_paths::normalize_os_path_string(trimmed);
        let input = Path::new(&normalized);

        let state = self.inner.state.lock_unpoisoned();
        let preset = preset_id.and_then(|id| state.presets.iter().find(|p| p.id == id));
        let plan = output_policy_paths::preview_video_output_path(input, preset, output_policy);
        Some(plan.output_path.to_string_lossy().into_owned())
    }

    /// Cancel a job by ID.
    pub fn cancel_job(&self, job_id: &str) -> bool {
        worker::cancel_job(&self.inner, job_id)
    }
    /// Cancel multiple jobs in a single atomic operation.
    pub fn cancel_jobs_bulk(&self, job_ids: Vec<String>) -> bool {
        worker::cancel_jobs_bulk(&self.inner, job_ids)
    }
    /// Request a job to pause (enter wait state).
    pub fn wait_job(&self, job_id: &str) -> bool {
        worker::wait_job(&self.inner, job_id)
    }
    /// Request multiple jobs to pause in a single atomic operation.
    pub fn wait_jobs_bulk(&self, job_ids: Vec<String>) -> bool {
        worker::wait_jobs_bulk(&self.inner, job_ids)
    }
    /// Request all queued + processing jobs to pause in a single atomic operation.
    ///
    /// Returns `(requested_job_count, processing_job_ids_at_request_time)`.
    pub fn wait_all_processing_and_queued_jobs_bulk(&self) -> (usize, Vec<String>) {
        worker::wait_all_processing_and_queued_jobs_bulk(&self.inner)
    }
    /// Resume a paused job.
    pub fn resume_job(&self, job_id: &str) -> bool {
        worker::resume_job(&self.inner, job_id)
    }
    /// Resume multiple jobs in a single atomic operation.
    pub fn resume_jobs_bulk(&self, job_ids: Vec<String>) -> bool {
        worker::resume_jobs_bulk(&self.inner, job_ids)
    }
    /// Restart a job from the beginning.
    pub fn restart_job(&self, job_id: &str) -> bool {
        worker::restart_job(&self.inner, job_id)
    }
    /// Restart multiple jobs in a single atomic operation.
    pub fn restart_jobs_bulk(&self, job_ids: Vec<String>) -> bool {
        worker::restart_jobs_bulk(&self.inner, job_ids)
    }

    /// Permanently delete a job from the in-memory queue state (terminal only).
    /// Running/queued jobs remain protected so the UI cannot hide active work.
    pub fn delete_job(&self, job_id: &str) -> bool {
        worker::delete_job(&self.inner, job_id)
    }
    /// Permanently delete multiple terminal-state jobs in a single atomic operation.
    pub fn delete_jobs_bulk(&self, job_ids: Vec<String>) -> bool {
        worker::delete_jobs_bulk(&self.inner, job_ids)
    }
    /// Permanently delete a Batch Compress batch (terminal children only).
    /// Used to delete a composite batch in one go instead of per-job deletes.
    pub fn delete_batch_compress_batch(&self, batch_id: &str) -> bool {
        worker::delete_batch_compress_batch(&self.inner, batch_id)
    }

    /// Permanently delete multiple Batch Compress batches in a single atomic operation.
    pub fn delete_batch_compress_batches_bulk(&self, batch_ids: Vec<String>) -> bool {
        worker::delete_batch_compress_batches_bulk(&self.inner, batch_ids)
    }

    /// Reorder the waiting jobs in the queue.
    pub fn reorder_waiting_jobs(&self, ordered_ids: Vec<String>) -> bool {
        worker::reorder_waiting_jobs(&self.inner, ordered_ids)
    }

    /// Sample current CPU usage.
    pub fn cpu_usage(&self) -> CpuUsageSnapshot {
        sample_cpu_usage()
    }

    /// Sample current GPU usage.
    pub fn gpu_usage(&self) -> GpuUsageSnapshot {
        sample_gpu_usage()
    }

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
