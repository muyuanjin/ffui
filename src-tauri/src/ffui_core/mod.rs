mod domain;
mod engine;
pub(crate) mod input_expand;
mod monitor;
mod monitor_activity;
mod settings;
pub mod tools;

pub use domain::*;
pub use engine::TranscodingEngine;
pub use engine::init_child_process_job;
// Expose core monitoring snapshots and GPU sampling helper so other modules
// (such as system_metrics) can reuse the same NVML-based logic.
pub use monitor::{CpuUsageSnapshot, GpuUsageSnapshot, sample_gpu_usage};
pub use monitor_activity::TranscodeActivityToday;
pub(crate) use monitor_activity::{
    emit_transcode_activity_today_if_possible, set_app_handle as set_transcode_activity_app_handle,
};
#[cfg_attr(not(windows), allow(unused_imports))]
pub use settings::{
    AppSettings, DEFAULT_METRICS_INTERVAL_MS, TaskbarProgressMode, TaskbarProgressScope,
    hardware_smart_default_presets,
};
pub use tools::{ExternalToolCandidate, ExternalToolStatus};
