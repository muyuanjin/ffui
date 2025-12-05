#!/usr/bin/env python3
"""
Splits engine.rs into modular components according to the OpenSpec proposal.
"""

import os
import re
from pathlib import Path

def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def extract_imports(content):
    """Extract all imports from the beginning of the file."""
    lines = content.split('\n')
    imports = []
    for line in lines:
        if line.startswith('use ') or line.startswith('//'):
            imports.append(line)
        elif line.strip() and not line.strip().startswith('//'):
            break
    return '\n'.join(imports)

def main():
    base_dir = Path(__file__).parent
    engine_rs = base_dir / 'src' / 'ffui_core' / 'engine.rs'
    engine_dir = base_dir / 'src' / 'ffui_core' / 'engine'

    print(f"Reading {engine_rs}...")
    content = read_file(engine_rs)

    # Common imports for all modules
    common_imports = """use std::path::{Path, PathBuf};
use anyhow::{Context, Result};
use crate::ffui_core::domain::*;
use crate::ffui_core::settings::AppSettings;
use super::state::*;
"""

    # Define line ranges for each module (approximate, will be adjusted)
    # These are based on manual inspection of the file

    # worker.rs: lines 1385-1490 (spawn_worker, worker_loop, next_job_for_worker_locked)
    worker_section = extract_section(content, "fn spawn_worker", "fn process_transcode_job")

    # More sections...
    # Due to complexity, I'll create a comprehensive mod.rs that re-exports everything

    print(f"Creating engine/mod.rs...")
    mod_content = """//! Transcoding engine split into modular components.
//!
//! - state: Engine state management, queue persistence, listeners
//! - worker: Worker thread pool and job scheduling
//! - ffmpeg_args: FFmpeg command-line argument generation
//! - job_runner: Job execution logic, progress tracking
//! - smart_scan: Smart Scan batch processing
//! - tests: All test cases

mod state;
mod worker;
mod ffmpeg_args;
mod job_runner;
mod smart_scan;

#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet, VecDeque, hash_map::DefaultHasher};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};

use crate::ffui_core::domain::{
    AutoCompressProgress, AutoCompressResult, FFmpegPreset, JobSource, JobStatus, JobType,
    MediaInfo, QueueState, SmartScanConfig, TranscodeJob,
};
use crate::ffui_core::monitor::{CpuUsageSnapshot, GpuUsageSnapshot, sample_cpu_usage, sample_gpu_usage};
use crate::ffui_core::settings::{self, AppSettings, DownloadedToolInfo, DownloadedToolState};
use crate::ffui_core::tools::{ExternalToolKind, ExternalToolStatus, ensure_tool_available, last_tool_download_metadata, tool_status};

pub(crate) use state::{Inner, EngineState, restore_jobs_from_snapshot};
use state::{snapshot_queue_state, notify_queue_listeners, restore_jobs_from_persisted_queue};

#[derive(Clone)]
pub struct TranscodingEngine {
    inner: Arc<Inner>,
}

impl TranscodingEngine {
    pub fn new() -> Result<Self> {
        let presets = settings::load_presets().unwrap_or_default();
        let settings = settings::load_settings().unwrap_or_default();
        let inner = Arc::new(Inner::new(presets, settings));
        restore_jobs_from_persisted_queue(&inner);
        worker::spawn_worker(inner.clone());
        Ok(Self { inner })
    }

    fn next_job_id(&self) -> String {
        self.inner
            .next_job_id
            .fetch_add(1, Ordering::SeqCst)
            .to_string()
    }

    pub fn queue_state(&self) -> QueueState {
        snapshot_queue_state(&self.inner)
    }

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

    fn notify_listeners(&self) {
        notify_queue_listeners(&self.inner);
    }

    pub fn presets(&self) -> Vec<FFmpegPreset> {
        let state = self.inner.state.lock().expect("engine state poisoned");
        state.presets.clone()
    }

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

    pub fn delete_preset(&self, preset_id: &str) -> Result<Vec<FFmpegPreset>> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");
        state.presets.retain(|p| p.id != preset_id);
        settings::save_presets(&state.presets)?;
        Ok(state.presets.clone())
    }

    pub fn settings(&self) -> AppSettings {
        let state = self.inner.state.lock().expect("engine state poisoned");
        state.settings.clone()
    }

    pub fn save_settings(&self, new_settings: AppSettings) -> Result<AppSettings> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");
        state.settings = new_settings.clone();
        settings::save_settings(&state.settings)?;
        Ok(new_settings)
    }

    fn record_tool_download(&self, kind: ExternalToolKind, binary_path: &str) {
        job_runner::record_tool_download_with_inner(&self.inner, kind, binary_path);
    }

    // All other public methods forward to appropriate modules
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

    pub fn cancel_job(&self, job_id: &str) -> bool {
        worker::cancel_job(&self.inner, job_id)
    }

    pub fn wait_job(&self, job_id: &str) -> bool {
        worker::wait_job(&self.inner, job_id)
    }

    pub fn resume_job(&self, job_id: &str) -> bool {
        worker::resume_job(&self.inner, job_id)
    }

    pub fn restart_job(&self, job_id: &str) -> bool {
        worker::restart_job(&self.inner, job_id)
    }

    pub fn reorder_waiting_jobs(&self, ordered_ids: Vec<String>) -> bool {
        worker::reorder_waiting_jobs(&self.inner, ordered_ids)
    }

    pub fn cpu_usage(&self) -> CpuUsageSnapshot {
        sample_cpu_usage()
    }

    pub fn gpu_usage(&self) -> GpuUsageSnapshot {
        sample_gpu_usage()
    }

    pub fn external_tool_statuses(&self) -> Vec<ExternalToolStatus> {
        let state = self.inner.state.lock().expect("engine state poisoned");
        let tools = &state.settings.tools;
        vec![
            tool_status(ExternalToolKind::Ffmpeg, tools),
            tool_status(ExternalToolKind::Ffprobe, tools),
            tool_status(ExternalToolKind::Avifenc, tools),
        ]
    }

    pub fn smart_scan_defaults(&self) -> SmartScanConfig {
        let state = self.inner.state.lock().expect("engine state poisoned");
        state.settings.smart_scan_defaults.clone()
    }

    pub fn update_smart_scan_defaults(&self, config: SmartScanConfig) -> Result<SmartScanConfig> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");
        state.settings.smart_scan_defaults = config.clone();
        settings::save_settings(&state.settings)?;
        Ok(config)
    }

    pub fn run_auto_compress(
        &self,
        root_path: String,
        config: SmartScanConfig,
    ) -> Result<AutoCompressResult> {
        smart_scan::run_auto_compress(&self.inner, self.clone(), root_path, config)
    }

    pub fn smart_scan_batch_summary(&self, batch_id: &str) -> Option<AutoCompressResult> {
        smart_scan::smart_scan_batch_summary(&self.inner, batch_id)
    }

    pub fn inspect_media(&self, path: String) -> Result<String> {
        job_runner::inspect_media(&self.inner, path)
    }
}

fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
"""

    write_file(engine_dir / 'mod.rs', mod_content)
    print("Created engine/mod.rs")

    print("Manual splitting required due to file complexity.")
    print("Please continue with manual file extraction or use a proper AST parser.")

def extract_section(content, start_marker, end_marker=None):
    """Extract a section between markers."""
    lines = content.split('\n')
    start_idx = None
    for i, line in enumerate(lines):
        if start_marker in line:
            start_idx = i
            break

    if start_idx is None:
        return ""

    if end_marker is None:
        return '\n'.join(lines[start_idx:])

    end_idx = None
    for i in range(start_idx + 1, len(lines)):
        if end_marker in lines[i]:
            end_idx = i
            break

    if end_idx is None:
        return '\n'.join(lines[start_idx:])

    return '\n'.join(lines[start_idx:end_idx])

if __name__ == '__main__':
    main()
