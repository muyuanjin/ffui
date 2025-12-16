mod compare_preview;
mod domain;
mod engine;
mod fallback_preview;
pub(crate) mod network_proxy;
pub(crate) mod input_expand;
mod monitor;
mod monitor_activity;
mod preview_cache;
mod settings;
pub mod tools;

pub(crate) use compare_preview::extract_concat_preview_frame;
#[cfg(test)]
pub(crate) use compare_preview::{
    build_concat_list_contents_for_tests, compare_frames_dir_for_tests,
};
pub use domain::*;
pub use engine::TranscodingEngine;
pub use engine::init_child_process_job;
pub(crate) use fallback_preview::{
    FallbackFramePosition, FallbackFrameQuality, clear_fallback_frame_cache, extract_fallback_frame,
};
// Expose core monitoring snapshots and GPU sampling helper so other modules
// (such as system_metrics) can reuse the same NVML-based logic.
pub use monitor::{CpuUsageSnapshot, GpuUsageSnapshot, sample_gpu_usage};
pub use monitor_activity::TranscodeActivityToday;
pub(crate) use monitor_activity::{
    emit_transcode_activity_today_if_possible, set_app_handle as set_transcode_activity_app_handle,
};
pub(crate) use preview_cache::{
    cleanup_unreferenced_previews, previews_root_dir_best_effort, referenced_preview_filenames,
};
#[cfg_attr(not(windows), allow(unused_imports))]
pub use settings::{
    AppSettings, DEFAULT_METRICS_INTERVAL_MS, TaskbarProgressMode, TaskbarProgressScope,
    hardware_smart_default_presets,
};
pub use tools::{ExternalToolCandidate, ExternalToolStatus};
