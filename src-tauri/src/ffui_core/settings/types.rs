use serde::{Deserialize, Serialize};

mod performance;
mod preset_panel_modes;
mod queue;
mod tool_custom_path_sanitize;
mod tools;
mod types_helpers;
mod ui;

pub use performance::{
    DEFAULT_MAX_PARALLEL_CPU_JOBS, DEFAULT_MAX_PARALLEL_HW_JOBS, DEFAULT_MAX_PARALLEL_JOBS,
    MAX_PARALLEL_JOBS_LIMIT, TranscodeParallelismMode,
};
pub use queue::{
    CrashRecoveryLogRetention, QueuePersistenceMode, TaskbarProgressMode, TaskbarProgressScope,
};
pub use tools::{
    DownloadedToolInfo, DownloadedToolState, ExternalToolSettings, RemoteToolVersionCache,
    RemoteToolVersionInfo,
};
pub use ui::{DEFAULT_UI_FONT_SIZE_PERCENT, DEFAULT_UI_SCALE_PERCENT, UiFontFamily};

pub use super::monitor_updater_types::{AppUpdaterSettings, MonitorSettings, TranscodeActivityDay};
use super::proxy::NetworkProxySettings;
pub use super::tool_probe_cache::{ExternalToolBinaryFingerprint, ExternalToolProbeCacheEntry};
pub type ExternalToolProbeCache = super::tool_probe_cache::ExternalToolProbeCache;
use crate::ffui_core::domain::{
    BatchCompressConfig, FileTypeFilter, ImageTargetFormat, OutputPolicy, SavingConditionType,
};
pub use preset_panel_modes::{PresetSortMode, PresetViewMode};

pub const fn default_preview_capture_percent() -> u8 {
    25
}

/// Default interval (in milliseconds) between structured ffmpeg progress
/// updates used when `progressUpdateIntervalMs` is not set in `AppSettings`.
pub const DEFAULT_PROGRESS_UPDATE_INTERVAL_MS: u16 = 250;

/// Default interval (in milliseconds) between system metrics samples when the
/// metrics interval is not explicitly configured via `AppSettings`.
pub const DEFAULT_METRICS_INTERVAL_MS: u16 = 1_000;

/// Default timeout (in seconds) for the "pause jobs on exit" graceful shutdown flow.
pub const DEFAULT_EXIT_AUTO_WAIT_TIMEOUT_SECONDS: f64 = 5.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub tools: ExternalToolSettings,
    pub batch_compress_defaults: BatchCompressConfig,
    /// Optional Monitor-only persisted state.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitor: Option<MonitorSettings>,
    /// Optional app updater settings and cached metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updater: Option<AppUpdaterSettings>,
    /// Optional network proxy settings. When omitted, behaves like System.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_proxy: Option<NetworkProxySettings>,
    /// Preferred UI locale (e.g. "en", "zh-CN"). When unset, the frontend uses
    /// its built-in default locale.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    /// Global UI scale in percent (e.g. 100 = default).
    #[serde(
        default = "types_helpers::default_ui_scale_percent",
        skip_serializing_if = "types_helpers::is_default_ui_scale_percent"
    )]
    pub ui_scale_percent: u16,
    /// Global base UI font size in percent (e.g. 100 = default).
    #[serde(
        default = "types_helpers::default_ui_font_size_percent",
        skip_serializing_if = "types_helpers::is_default_ui_font_size_percent"
    )]
    pub ui_font_size_percent: u16,
    /// Global UI font family preference.
    #[serde(
        default,
        skip_serializing_if = "types_helpers::is_ui_font_family_system"
    )]
    pub ui_font_family: UiFontFamily,
    /// Optional specific UI font family name (e.g. `Consolas`, `Microsoft YaHei`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_font_name: Option<String>,
    /// Optional open-source font id to download/cache and use globally.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_font_download_id: Option<String>,
    /// Optional absolute path to an imported user font file under the app data directory.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_font_file_path: Option<String>,
    /// Optional original filename of the imported UI font (display only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_font_file_source_name: Option<String>,
    #[serde(default = "default_preview_capture_percent")]
    pub preview_capture_percent: u8,
    /// When true, enable developer-focused features such as opening the
    /// webview devtools from the UI. This flag is persisted so power users
    /// don't need to re-enable it on every launch.
    #[serde(default, skip_serializing_if = "types_helpers::is_false")]
    pub developer_mode_enabled: bool,
    /// Optional default preset id for manual queue jobs. When None or empty,
    /// the first available preset will be used.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_queue_preset_id: Option<String>,
    /// Optional preset sort mode for the presets panel and dropdown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset_sort_mode: Option<PresetSortMode>,
    /// Optional preset view mode for the presets panel.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset_view_mode: Option<PresetViewMode>,
    /// Concurrency strategy for transcoding workers (unified cap or CPU/HW split).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallelism_mode: Option<TranscodeParallelismMode>,
    /// Optional upper bound for concurrent transcoding jobs (unified mode).
    /// Values must be >= 1; legacy 0 is treated as unset/default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_parallel_jobs: Option<u8>,
    /// Optional upper bound for concurrent CPU/software-encoded jobs (split mode).
    /// Values must be >= 1; legacy 0 is treated as unset/default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_parallel_cpu_jobs: Option<u8>,
    /// Optional upper bound for concurrent hardware-encoded jobs (split mode).
    /// Values must be >= 1; legacy 0 is treated as unset/default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_parallel_hw_jobs: Option<u8>,
    /// Optional interval in milliseconds between backend progress updates
    /// for ffmpeg-based jobs when using the bundled static binary. When
    /// unset, the engine uses a conservative default so existing installs
    /// keep their previous behaviour.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_update_interval_ms: Option<u16>,
    /// When true (default), show the in-app custom titlebar progress bar.
    #[serde(
        default = "types_helpers::default_titlebar_progress_enabled",
        skip_serializing_if = "types_helpers::is_true"
    )]
    pub titlebar_progress_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_backtrack_seconds: Option<f64>,
    /// When true (default), closing/exiting the app while jobs are running will
    /// prompt the user and can attempt a best-effort "pause on exit" flow so
    /// multi-segment recovery remains usable after restart.
    #[serde(
        default = "types_helpers::default_exit_auto_wait_enabled",
        skip_serializing_if = "types_helpers::is_true"
    )]
    pub exit_auto_wait_enabled: bool,
    /// Timeout (seconds) for the "pause on exit" flow before giving up and
    /// allowing the app to close.
    #[serde(
        default = "types_helpers::default_exit_auto_wait_timeout_seconds",
        skip_serializing_if = "types_helpers::is_default_exit_auto_wait_timeout_seconds"
    )]
    pub exit_auto_wait_timeout_seconds: f64,
    /// Optional interval in milliseconds between system metrics samples (falls back to `DEFAULT_METRICS_INTERVAL_MS`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics_interval_ms: Option<u16>,
    /// Aggregation mode for computing taskbar progress from the queue. When
    /// omitted in existing settings.json files, this defaults to an
    /// estimated-time based mode for better weighting of heavy presets.
    pub taskbar_progress_mode: TaskbarProgressMode,
    /// 控制任务栏进度计算是否包含已结束任务。缺省保持历史行为。
    pub taskbar_progress_scope: TaskbarProgressScope,
    /// Queue persistence strategy. When omitted in existing settings.json
    /// files this defaults to `None` so older installs keep the previous
    /// behaviour of not restoring queue state unless explicitly enabled.
    pub queue_persistence_mode: QueuePersistenceMode,
    /// Optional retention limits for per-job terminal log files when crash recovery is enabled in full-log mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crash_recovery_log_retention: Option<CrashRecoveryLogRetention>,
    /// One-time onboarding completion marker. When true, the smart preset /
    /// tools onboarding flow will not auto-run again on startup.
    #[serde(default, skip_serializing_if = "types_helpers::is_false")]
    pub onboarding_completed: bool,
    /// Whether the queue selection toolbar should remain visible even when no jobs are selected.
    #[serde(default, skip_serializing_if = "types_helpers::is_false")]
    pub selection_bar_pinned: bool,
    /// Whether the preset selection toolbar should remain visible even when no presets are selected.
    #[serde(default, skip_serializing_if = "types_helpers::is_false")]
    pub preset_selection_bar_pinned: bool,
    /// Output policy for manual queue enqueues (container/dir/name/timestamps).
    #[serde(
        default,
        skip_serializing_if = "types_helpers::is_default_output_policy"
    )]
    pub queue_output_policy: OutputPolicy,
}
impl AppSettings {
    pub fn normalize(&mut self) {
        self.max_parallel_jobs = types_helpers::normalize_parallel_limit(self.max_parallel_jobs);
        self.max_parallel_cpu_jobs =
            types_helpers::normalize_parallel_limit(self.max_parallel_cpu_jobs);
        self.max_parallel_hw_jobs =
            types_helpers::normalize_parallel_limit(self.max_parallel_hw_jobs);
        types_helpers::normalize_string_option(&mut self.locale);
        if matches!(self.preset_sort_mode, Some(PresetSortMode::Unknown)) {
            self.preset_sort_mode = None;
        }
        if matches!(self.preset_view_mode, Some(PresetViewMode::Unknown)) {
            self.preset_view_mode = None;
        }
        self.tools
            .sanitize_custom_paths_for_auto_managed_downloads();

        // Preserve user-configured values (including <= 0 for "infinite wait") while
        // still recovering from invalid numeric inputs.
        if !self.exit_auto_wait_timeout_seconds.is_finite() {
            self.exit_auto_wait_timeout_seconds = DEFAULT_EXIT_AUTO_WAIT_TIMEOUT_SECONDS;
        }
    }

    pub fn parallelism_mode(&self) -> TranscodeParallelismMode {
        self.parallelism_mode.unwrap_or_default()
    }

    pub fn effective_max_parallel_jobs(&self) -> u8 {
        types_helpers::effective_parallel_limit(self.max_parallel_jobs, DEFAULT_MAX_PARALLEL_JOBS)
    }

    pub fn effective_max_parallel_cpu_jobs(&self) -> u8 {
        types_helpers::effective_parallel_limit(
            self.max_parallel_cpu_jobs,
            DEFAULT_MAX_PARALLEL_CPU_JOBS,
        )
    }

    pub fn effective_max_parallel_hw_jobs(&self) -> u8 {
        types_helpers::effective_parallel_limit(
            self.max_parallel_hw_jobs,
            DEFAULT_MAX_PARALLEL_HW_JOBS,
        )
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            tools: ExternalToolSettings::default(),
            batch_compress_defaults: BatchCompressConfig {
                root_path: None,
                replace_original: true,
                min_image_size_kb: 50,
                min_video_size_mb: 50,
                min_audio_size_kb: 500,
                saving_condition_type: SavingConditionType::Ratio,
                min_saving_ratio: 0.95,
                min_saving_absolute_mb: 5.0,
                image_target_format: ImageTargetFormat::Avif,
                video_preset_id: String::new(),
                audio_preset_id: None,
                video_filter: FileTypeFilter {
                    enabled: true,
                    extensions: vec![
                        "mp4".to_string(),
                        "mkv".to_string(),
                        "mov".to_string(),
                        "avi".to_string(),
                        "flv".to_string(),
                        "ts".to_string(),
                        "m2ts".to_string(),
                        "wmv".to_string(),
                        "webm".to_string(),
                    ],
                },
                image_filter: FileTypeFilter {
                    enabled: true,
                    extensions: vec![
                        "jpg".to_string(),
                        "jpeg".to_string(),
                        "png".to_string(),
                        "bmp".to_string(),
                        "tif".to_string(),
                        "tiff".to_string(),
                        "webp".to_string(),
                        "gif".to_string(),
                    ],
                },
                audio_filter: FileTypeFilter {
                    enabled: false,
                    extensions: vec![
                        "mp3".to_string(),
                        "wav".to_string(),
                        "flac".to_string(),
                        "aac".to_string(),
                        "ogg".to_string(),
                        "m4a".to_string(),
                        "wma".to_string(),
                        "opus".to_string(),
                    ],
                },
                output_policy: OutputPolicy::default(),
            },
            monitor: None,
            updater: None,
            network_proxy: None,
            locale: None,
            ui_scale_percent: types_helpers::default_ui_scale_percent(),
            ui_font_size_percent: types_helpers::default_ui_font_size_percent(),
            ui_font_family: UiFontFamily::default(),
            ui_font_name: None,
            ui_font_download_id: None,
            ui_font_file_path: None,
            ui_font_file_source_name: None,
            preview_capture_percent: default_preview_capture_percent(),
            developer_mode_enabled: false,
            default_queue_preset_id: None,
            preset_sort_mode: None,
            preset_view_mode: None,
            parallelism_mode: None,
            max_parallel_jobs: None,
            max_parallel_cpu_jobs: None,
            max_parallel_hw_jobs: None,
            progress_update_interval_ms: None,
            titlebar_progress_enabled: types_helpers::default_titlebar_progress_enabled(),
            resume_backtrack_seconds: None,
            exit_auto_wait_enabled: types_helpers::default_exit_auto_wait_enabled(),
            exit_auto_wait_timeout_seconds: types_helpers::default_exit_auto_wait_timeout_seconds(),
            metrics_interval_ms: None,
            taskbar_progress_mode: TaskbarProgressMode::default(),
            taskbar_progress_scope: TaskbarProgressScope::default(),
            queue_persistence_mode: QueuePersistenceMode::default(),
            crash_recovery_log_retention: None,
            onboarding_completed: false,
            selection_bar_pinned: false,
            preset_selection_bar_pinned: false,
            queue_output_policy: OutputPolicy::default(),
        }
    }
}
