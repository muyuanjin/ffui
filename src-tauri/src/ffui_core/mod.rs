#![allow(clippy::redundant_pub_crate)]

mod compare_preview;
mod config_bundle;
mod data_root;
mod domain;
mod engine;
mod fallback_preview;
mod ffprobe;
pub(crate) mod input_expand;
mod monitor;
mod monitor_activity;
pub(crate) mod network_proxy;
mod preset_bundle;
mod preview_cache;
mod preview_common;
mod settings;
pub mod tools;

pub(crate) use compare_preview::extract_concat_preview_frame;
#[cfg(test)]
pub(crate) use compare_preview::{
    build_concat_list_contents_for_tests, compare_frames_dir_for_tests,
};
pub(crate) use config_bundle::{
    ConfigBundle, ConfigBundleExportResult, ConfigBundleImportResult, export_config_bundle,
    read_config_bundle,
};
pub(crate) use data_root::{
    DataRootInfo, DataRootMode, acknowledge_fallback_notice, clear_app_data_root, data_root_dir,
    data_root_info, init_data_root, previews_dir, queue_logs_dir, queue_state_path,
    set_desired_mode as set_data_root_mode, tools_dir, ui_fonts_dir,
};
#[cfg(test)]
pub(crate) use data_root::{override_data_root_dir_for_tests, presets_path};
pub use domain::*;
#[cfg(test)]
pub(crate) use engine::lock_persist_test_mutex_for_tests;
pub use engine::{TranscodingEngine, init_child_process_job};
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
pub(crate) use preset_bundle::{
    PresetBundle, PresetBundleExportResult, export_presets_bundle, read_presets_bundle,
};
pub(crate) use preview_cache::{
    cleanup_unreferenced_previews, previews_root_dir_best_effort, referenced_preview_filenames,
};
#[allow(unused_imports)]
pub use settings::QueuePersistenceMode;
pub(crate) use settings::load_presets;
#[cfg_attr(not(windows), allow(unused_imports))]
pub use settings::{
    AppSettings, DEFAULT_EXIT_AUTO_WAIT_TIMEOUT_SECONDS, DEFAULT_METRICS_INTERVAL_MS,
    TaskbarProgressMode, TaskbarProgressScope, hardware_smart_default_presets,
};
pub use tools::{ExternalToolCandidate, ExternalToolStatus};
