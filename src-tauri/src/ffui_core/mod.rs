mod domain;
mod engine;
mod monitor;
mod settings;
pub mod tools;

pub use domain::*;
pub use engine::TranscodingEngine;
pub use engine::init_child_process_job;
// Expose core monitoring snapshots and GPU sampling helper so other modules
// (such as system_metrics) can reuse the same NVML-based logic.
pub use monitor::{CpuUsageSnapshot, GpuUsageSnapshot, sample_gpu_usage};
pub use settings::{
    AppSettings, DEFAULT_METRICS_INTERVAL_MS, TaskbarProgressMode, hardware_smart_default_presets,
};
pub use tools::{ExternalToolCandidate, ExternalToolStatus};
