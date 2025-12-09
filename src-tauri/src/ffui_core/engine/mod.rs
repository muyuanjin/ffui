//! Transcoding engine split into modular components.
//!
//! Module structure:
//! - `state`: Engine state management, queue persistence, listeners
//! - `ffmpeg_args`: FFmpeg command-line argument generation and parsing
//! - `worker`: Worker thread pool and job scheduling
//! - `job_runner`: Job execution logic, progress tracking
//! - `smart_scan`: Smart Scan batch processing
//! - `tests`: All test cases

mod ffmpeg_args;
mod job_runner;
mod smart_scan;
mod state;
mod state_persist;
mod worker;
mod worker_utils;

#[cfg(test)]
mod tests;

// 测试环境下为 TranscodingEngine::new 加一层全局互斥锁，避免多个单元测试
// 并发初始化引擎时在共享全局状态（例如队列和设置）上产生竞争条件。
#[cfg(test)]
static ENGINE_TEST_MUTEX: once_cell::sync::Lazy<std::sync::Mutex<()>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(()));
// 导出 Job Object 初始化函数，供应用启动时调用
pub use ffmpeg_args::init_child_process_job;

use std::sync::Arc;

use anyhow::Result;

use crate::ffui_core::domain::{
    AutoCompressProgress, AutoCompressResult, FFmpegPreset, JobSource, JobType, QueueState,
    QueueStateLite, SmartScanConfig, TranscodeJob,
};
use crate::ffui_core::monitor::{
    CpuUsageSnapshot, GpuUsageSnapshot, sample_cpu_usage, sample_gpu_usage,
};
use crate::ffui_core::settings::{self, AppSettings};
use crate::ffui_core::tools::{
    ExternalToolKind, ExternalToolStatus, clear_tool_runtime_error,
    hydrate_last_tool_download_from_settings, tool_status,
};

use state::{Inner, restore_jobs_from_persisted_queue, snapshot_queue_state};

/// The main transcoding engine facade.
///
/// This struct provides the public API for transcoding operations while
/// delegating implementation details to specialized sub-modules.
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
        let _guard = ENGINE_TEST_MUTEX
            .lock()
            .expect("ENGINE_TEST_MUTEX lock poisoned");

        let presets = settings::load_presets().unwrap_or_default();
        let settings = settings::load_settings().unwrap_or_default();
        hydrate_last_tool_download_from_settings(&settings.tools);
        let inner = Arc::new(Inner::new(presets, settings));
        {
            // Crash-recovery from the persisted queue state can involve heavy
            // disk I/O and JSON parsing if previous jobs carried large logs.
            // Run this on a dedicated background thread so application startup
            // is never blocked by queue deserialization.
            let inner_clone = inner.clone();
            std::thread::Builder::new()
                .name("ffui-queue-recovery".to_string())
                .spawn(move || {
                    restore_jobs_from_persisted_queue(&inner_clone);
                })
                .expect("failed to spawn queue recovery thread");
        }
        worker::spawn_worker(inner.clone());
        Ok(Self { inner })
    }

    /// Get a snapshot of the current queue state.
    pub fn queue_state(&self) -> QueueState {
        snapshot_queue_state(&self.inner)
    }

    /// Get a lightweight snapshot of the current queue state for high-
    /// frequency updates and startup payloads.
    pub fn queue_state_lite(&self) -> QueueStateLite {
        // For now we reuse the full snapshot and convert it into the lite
        // representation, which strips heavy fields like the full logs vector
        // from the serialized payload.
        let full = snapshot_queue_state(&self.inner);
        QueueStateLite::from(&full)
    }

    /// Fetch full details for a single job from the in-memory engine state.
    pub fn job_detail(&self, job_id: &str) -> Option<TranscodeJob> {
        let state = self.inner.state.lock().expect("engine state poisoned");
        state.jobs.get(job_id).cloned()
    }

    /// Register a listener for queue state changes.
    pub fn register_queue_listener<F>(&self, listener: F)
    where
        F: Fn(QueueState) + Send + Sync + 'static,
    {
        let mut listeners = self
            .inner
            .queue_listeners
            .lock()
            .expect("queue listeners lock poisoned");
        listeners.push(Arc::new(listener));
    }

    /// Register a listener for Smart Scan progress updates.
    pub fn register_smart_scan_listener<F>(&self, listener: F)
    where
        F: Fn(AutoCompressProgress) + Send + Sync + 'static,
    {
        let mut listeners = self
            .inner
            .smart_scan_listeners
            .lock()
            .expect("smart scan listeners lock poisoned");
        listeners.push(Arc::new(listener));
    }

    /// Get the list of available presets.
    pub fn presets(&self) -> Vec<FFmpegPreset> {
        let state = self.inner.state.lock().expect("engine state poisoned");
        state.presets.clone()
    }

    /// Save or update a preset.
    pub fn save_preset(&self, preset: FFmpegPreset) -> Result<Vec<FFmpegPreset>> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");
        if let Some(existing) = state.presets.iter_mut().find(|p| p.id == preset.id) {
            *existing = preset;
        } else {
            state.presets.push(preset);
        }
        settings::save_presets(&state.presets)?;
        Ok(state.presets.clone())
    }

    /// Delete a preset by ID.
    pub fn delete_preset(&self, preset_id: &str) -> Result<Vec<FFmpegPreset>> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");
        state.presets.retain(|p| p.id != preset_id);
        settings::save_presets(&state.presets)?;
        Ok(state.presets.clone())
    }

    /// Reorder presets according to the provided list of IDs.
    ///
    /// The new order is determined by the `ordered_ids` slice. Any preset IDs
    /// not present in the slice are appended at the end in their original order.
    pub fn reorder_presets(&self, ordered_ids: &[String]) -> Result<Vec<FFmpegPreset>> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");

        // Build index map for O(1) lookup
        let id_to_index: std::collections::HashMap<&str, usize> = ordered_ids
            .iter()
            .enumerate()
            .map(|(i, id)| (id.as_str(), i))
            .collect();

        // Sort presets: those in ordered_ids come first (in that order),
        // others are appended at the end preserving their relative order.
        let max_idx = ordered_ids.len();
        state.presets.sort_by(|a, b| {
            let idx_a = id_to_index.get(a.id.as_str()).copied().unwrap_or(max_idx);
            let idx_b = id_to_index.get(b.id.as_str()).copied().unwrap_or(max_idx);
            idx_a.cmp(&idx_b)
        });

        settings::save_presets(&state.presets)?;
        Ok(state.presets.clone())
    }

    /// Get the current application settings.
    pub fn settings(&self) -> AppSettings {
        let state = self.inner.state.lock().expect("engine state poisoned");
        state.settings.clone()
    }

    /// Save new application settings.
    pub fn save_settings(&self, new_settings: AppSettings) -> Result<AppSettings> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");

        // 在后台记录旧的 tools 配置，用于判断是否需要清理外部工具的错误状态。
        let old_tools = state.settings.tools.clone();

        state.settings = new_settings.clone();
        settings::save_settings(&state.settings)?;

        // 如果外部工具相关配置发生了变化（自定义路径或自动管理策略），
        // 则清理所有外部工具的错误信息与架构不兼容标记，避免旧错误粘在 UI 上。
        let new_tools = &state.settings.tools;
        let tools_changed = old_tools.ffmpeg_path != new_tools.ffmpeg_path
            || old_tools.ffprobe_path != new_tools.ffprobe_path
            || old_tools.avifenc_path != new_tools.avifenc_path
            || old_tools.auto_download != new_tools.auto_download
            || old_tools.auto_update != new_tools.auto_update;

        if tools_changed {
            clear_tool_runtime_error(ExternalToolKind::Ffmpeg);
            clear_tool_runtime_error(ExternalToolKind::Ffprobe);
            clear_tool_runtime_error(ExternalToolKind::Avifenc);
        }

        Ok(new_settings)
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

    /// Cancel a job by ID.
    pub fn cancel_job(&self, job_id: &str) -> bool {
        worker::cancel_job(&self.inner, job_id)
    }

    /// Request a job to pause (enter wait state).
    pub fn wait_job(&self, job_id: &str) -> bool {
        worker::wait_job(&self.inner, job_id)
    }

    /// Resume a paused job.
    pub fn resume_job(&self, job_id: &str) -> bool {
        worker::resume_job(&self.inner, job_id)
    }

    /// Restart a job from the beginning.
    pub fn restart_job(&self, job_id: &str) -> bool {
        worker::restart_job(&self.inner, job_id)
    }

    /// Permanently delete a job from the in-memory queue state.
    ///
    /// Only jobs that are already in a terminal state (completed/failed/
    /// skipped/cancelled) are eligible for deletion. Running or waiting
    /// jobs remain protected so the UI cannot "hide" active work.
    pub fn delete_job(&self, job_id: &str) -> bool {
        worker::delete_job(&self.inner, job_id)
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
    ///
    /// This is used by the Settings panel “下载 / 更新”按钮 so that once a
    /// user-initiated download completes, the freshly downloaded binary
    /// becomes the preferred path in settings.json and the Settings UI.
    pub fn record_manual_tool_download(&self, kind: ExternalToolKind, binary_path: &str) {
        job_runner::record_tool_download_with_inner(&self.inner, kind, binary_path);
    }

    /// Get the status of all external tools.
    pub fn external_tool_statuses(&self) -> Vec<ExternalToolStatus> {
        let state = self.inner.state.lock().expect("engine state poisoned");
        let tools = &state.settings.tools;
        let statuses = vec![
            tool_status(ExternalToolKind::Ffmpeg, tools),
            tool_status(ExternalToolKind::Ffprobe, tools),
            tool_status(ExternalToolKind::Avifenc, tools),
        ];

        // Cache a snapshot for event-based updates so the tools module can
        // emit ffui://external-tool-status without re-probing the filesystem
        // on every download tick.
        crate::ffui_core::tools::update_latest_status_snapshot(statuses.clone());

        statuses
    }

    /// Get the Smart Scan default configuration.
    pub fn smart_scan_defaults(&self) -> SmartScanConfig {
        let state = self.inner.state.lock().expect("engine state poisoned");
        state.settings.smart_scan_defaults.clone()
    }

    /// Update the Smart Scan default configuration.
    pub fn update_smart_scan_defaults(&self, config: SmartScanConfig) -> Result<SmartScanConfig> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");
        state.settings.smart_scan_defaults = config.clone();
        settings::save_settings(&state.settings)?;
        Ok(config)
    }

    /// Run Smart Scan auto-compress on a directory.
    pub fn run_auto_compress(
        &self,
        root_path: String,
        config: SmartScanConfig,
    ) -> Result<AutoCompressResult> {
        smart_scan::run_auto_compress(&self.inner, root_path, config)
    }

    /// Get the summary of a Smart Scan batch.
    #[cfg(test)]
    pub fn smart_scan_batch_summary(&self, batch_id: &str) -> Option<AutoCompressResult> {
        smart_scan::smart_scan_batch_summary(&self.inner, batch_id)
    }

    /// Inspect media file metadata using ffprobe.
    pub fn inspect_media(&self, path: String) -> Result<String> {
        job_runner::inspect_media(&self.inner, path)
    }
}
