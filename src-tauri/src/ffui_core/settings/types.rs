use serde::{Deserialize, Serialize};

use crate::ffui_core::domain::{
    FileTypeFilter, ImageTargetFormat, OutputPolicy, SavingConditionType, SmartScanConfig,
};

/// Human-readable metadata for a downloaded tool binary.
/// All fields are optional so existing settings.json files remain valid and minimal.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DownloadedToolInfo {
    /// Human-readable version string for the downloaded tool, e.g. "6.0".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Optional tag or build identifier, e.g. "b6.0" for ffmpeg-static.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// Source URL used to download this binary.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    /// Unix epoch timestamp in milliseconds when the download completed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded_at: Option<u64>,
}

/// Per-tool metadata for auto-downloaded binaries. All fields are optional so
/// existing settings.json files remain valid and minimal.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DownloadedToolState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ffmpeg: Option<DownloadedToolInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ffprobe: Option<DownloadedToolInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avifenc: Option<DownloadedToolInfo>,
}

/// Cached remote tool version metadata (for update hints) persisted across restarts.
///
/// All fields are optional so existing settings.json files remain valid and minimal.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RemoteToolVersionInfo {
    /// Unix epoch timestamp in milliseconds when the remote check completed successfully.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at_ms: Option<u64>,
    /// Latest known remote version string, e.g. "6.1.1".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Optional upstream tag/build identifier, e.g. "b6.1.1".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

/// Remote version caches for tools that support remote update hints.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RemoteToolVersionCache {
    /// Cached remote release metadata for the ffmpeg-static upstream used by ffmpeg/ffprobe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ffmpeg_static: Option<RemoteToolVersionInfo>,
    /// Cached remote release metadata for libavif upstream used by avifenc.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub libavif: Option<RemoteToolVersionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ExternalToolSettings {
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub avifenc_path: Option<String>,
    pub auto_download: bool,
    pub auto_update: bool,
    /// Optional metadata about binaries that were auto-downloaded by the app.
    /// When absent, the app infers availability only from the filesystem.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded: Option<DownloadedToolState>,
    /// Optional cached remote-version metadata (TTL-based) for update hints.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_version_cache: Option<RemoteToolVersionCache>,
}

pub fn default_preview_capture_percent() -> u8 {
    25
}

/// Default interval (in milliseconds) between structured ffmpeg progress
/// updates used when progressUpdateIntervalMs is not set in AppSettings.
pub const DEFAULT_PROGRESS_UPDATE_INTERVAL_MS: u16 = 250;

/// Default interval (in milliseconds) between system metrics samples when the
/// metrics interval is not explicitly configured via AppSettings.
pub const DEFAULT_METRICS_INTERVAL_MS: u16 = 1_000;

/// Default max number of concurrent transcoding jobs when using unified scheduling.
pub const DEFAULT_MAX_PARALLEL_JOBS: u8 = 2;
/// Default max number of concurrent CPU/software-encoded jobs when using split scheduling.
pub const DEFAULT_MAX_PARALLEL_CPU_JOBS: u8 = 2;
/// Default max number of concurrent hardware-encoded jobs when using split scheduling.
pub const DEFAULT_MAX_PARALLEL_HW_JOBS: u8 = 1;
/// Hard upper bound to avoid spawning an unreasonable number of worker threads.
pub const MAX_PARALLEL_JOBS_LIMIT: u8 = 32;

/// Default UI scale in percent (e.g. 100 = normal).
pub const DEFAULT_UI_SCALE_PERCENT: u16 = 100;

fn default_ui_scale_percent() -> u16 {
    DEFAULT_UI_SCALE_PERCENT
}

fn is_default_ui_scale_percent(value: &u16) -> bool {
    *value == DEFAULT_UI_SCALE_PERCENT
}

/// Default UI font size in percent (e.g. 100 = normal).
pub const DEFAULT_UI_FONT_SIZE_PERCENT: u16 = 100;

fn default_ui_font_size_percent() -> u16 {
    DEFAULT_UI_FONT_SIZE_PERCENT
}

fn is_default_ui_font_size_percent(value: &u16) -> bool {
    *value == DEFAULT_UI_FONT_SIZE_PERCENT
}

/// Aggregation modes for computing a single queue-level progress value that
/// is surfaced to the Windows taskbar. This is configured via AppSettings and
/// determines how individual jobs contribute to the overall progress bar.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::enum_variant_names)]
pub enum TaskbarProgressMode {
    /// Weight jobs by their input size in megabytes. Simple and robust.
    BySize,
    /// Weight jobs by media duration in seconds when available.
    ByDuration,
    /// Weight jobs by an estimated processing time derived from historical
    /// preset statistics, falling back to duration/size heuristics.
    #[default]
    ByEstimatedTime,
}

/// 控制任务栏进度计算时纳入哪些任务。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum TaskbarProgressScope {
    /// 与现有行为一致：所有任务（含已结束）都会参与聚合。
    #[default]
    AllJobs,
    /// 仅统计仍在排队或进行中的任务；若队列全部终态则回退为全部任务以显示 100%。
    ActiveAndQueued,
}

/// Global UI font family preference.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum UiFontFamily {
    /// Use platform default UI font stack.
    #[default]
    System,
    /// Prefer sans-serif stack (still falls back to system defaults).
    Sans,
    /// Prefer monospace stack (useful for logs/commands).
    Mono,
}

fn is_ui_font_family_system(value: &UiFontFamily) -> bool {
    *value == UiFontFamily::System
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn is_true(value: &bool) -> bool {
    *value
}

fn default_true() -> bool {
    true
}

/// Queue persistence mode for crash-recovery. This controls whether the
/// engine writes queue-state snapshots to disk and attempts to restore them
/// on startup.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum QueuePersistenceMode {
    /// Do not persist or restore the queue at all. This is the default and
    /// treats the queue as an in-memory session without crash recovery.
    #[default]
    None,
    /// Persist lightweight queue snapshots (no full logs) for crash recovery.
    #[serde(alias = "crashRecovery")]
    CrashRecoveryLite,
    /// Persist lightweight queue snapshots plus per-job full logs for terminal
    /// jobs, so users can still inspect full logs after a restart.
    CrashRecoveryFull,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrashRecoveryLogRetention {
    /// Maximum number of per-job terminal log files to keep on disk. When None,
    /// a conservative default will be applied.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_files: Option<u16>,
    /// Maximum total size in megabytes for all terminal log files. When None,
    /// a conservative default will be applied.
    #[serde(skip_serializing_if = "Option::is_none", alias = "maxTotalMB")]
    pub max_total_mb: Option<u16>,
}

impl Default for CrashRecoveryLogRetention {
    fn default() -> Self {
        Self {
            max_files: Some(200),
            max_total_mb: Some(512),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeActivityDay {
    pub date: String,
    pub active_hours_mask: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MonitorSettings {
    /// Bounded recent activity days for the transcode heatmap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcode_activity_days: Option<Vec<TranscodeActivityDay>>,
}

/// Persisted updater preferences and cached metadata.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AppUpdaterSettings {
    /// When true (default), check for updates on startup (TTL-based).
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub auto_check: bool,
    /// Unix epoch timestamp in milliseconds when the last update check completed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checked_at_ms: Option<u64>,
    /// Latest known available version when the last check found an update.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_version: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TranscodeParallelismMode {
    #[default]
    Unified,
    Split,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub tools: ExternalToolSettings,
    pub smart_scan_defaults: SmartScanConfig,
    /// Optional Monitor-only persisted state.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitor: Option<MonitorSettings>,
    /// Optional app updater settings and cached metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updater: Option<AppUpdaterSettings>,
    /// Global UI scale in percent (e.g. 100 = default).
    #[serde(
        default = "default_ui_scale_percent",
        skip_serializing_if = "is_default_ui_scale_percent"
    )]
    pub ui_scale_percent: u16,
    /// Global base UI font size in percent (e.g. 100 = default).
    #[serde(
        default = "default_ui_font_size_percent",
        skip_serializing_if = "is_default_ui_font_size_percent"
    )]
    pub ui_font_size_percent: u16,
    /// Global UI font family preference.
    #[serde(default, skip_serializing_if = "is_ui_font_family_system")]
    pub ui_font_family: UiFontFamily,
    /// Optional specific UI font family name (e.g. "Consolas", "Microsoft YaHei").
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
    #[serde(default, skip_serializing_if = "is_false")]
    pub developer_mode_enabled: bool,
    /// Optional default preset id for manual queue jobs. When None or empty,
    /// the first available preset will be used.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_queue_preset_id: Option<String>,
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
    /// Optional interval in milliseconds between system metrics samples.
    /// When unset, the backend falls back to DEFAULT_METRICS_INTERVAL_MS.
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
    /// Optional retention limits for per-job terminal log files when crash
    /// recovery is enabled in full-log mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crash_recovery_log_retention: Option<CrashRecoveryLogRetention>,
    /// One-time onboarding completion marker. When true, the smart preset /
    /// tools onboarding flow will not auto-run again on startup.
    #[serde(default, skip_serializing_if = "is_false")]
    pub onboarding_completed: bool,
    /// Whether the queue selection toolbar should remain visible even when no
    /// jobs are selected. This powers the "Pin toolbar" UI toggle.
    #[serde(default, skip_serializing_if = "is_false")]
    pub selection_bar_pinned: bool,
    /// Output policy for manual queue enqueues (container/dir/name/timestamps).
    #[serde(default, skip_serializing_if = "is_default_output_policy")]
    pub queue_output_policy: OutputPolicy,
}

fn is_default_output_policy(policy: &OutputPolicy) -> bool {
    *policy == OutputPolicy::default()
}

impl AppSettings {
    pub fn normalize(&mut self) {
        self.max_parallel_jobs = normalize_parallel_limit(self.max_parallel_jobs);
        self.max_parallel_cpu_jobs = normalize_parallel_limit(self.max_parallel_cpu_jobs);
        self.max_parallel_hw_jobs = normalize_parallel_limit(self.max_parallel_hw_jobs);
    }

    pub fn parallelism_mode(&self) -> TranscodeParallelismMode {
        self.parallelism_mode.unwrap_or_default()
    }

    pub fn effective_max_parallel_jobs(&self) -> u8 {
        effective_parallel_limit(self.max_parallel_jobs, DEFAULT_MAX_PARALLEL_JOBS)
    }

    pub fn effective_max_parallel_cpu_jobs(&self) -> u8 {
        effective_parallel_limit(self.max_parallel_cpu_jobs, DEFAULT_MAX_PARALLEL_CPU_JOBS)
    }

    pub fn effective_max_parallel_hw_jobs(&self) -> u8 {
        effective_parallel_limit(self.max_parallel_hw_jobs, DEFAULT_MAX_PARALLEL_HW_JOBS)
    }
}

fn normalize_parallel_limit(value: Option<u8>) -> Option<u8> {
    match value {
        Some(0) => None,
        Some(v) => Some(v.clamp(1, MAX_PARALLEL_JOBS_LIMIT)),
        None => None,
    }
}

fn effective_parallel_limit(value: Option<u8>, default_value: u8) -> u8 {
    match value {
        Some(v) if v >= 1 => v.clamp(1, MAX_PARALLEL_JOBS_LIMIT),
        _ => default_value,
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            tools: ExternalToolSettings::default(),
            smart_scan_defaults: SmartScanConfig {
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
            ui_scale_percent: default_ui_scale_percent(),
            ui_font_size_percent: default_ui_font_size_percent(),
            ui_font_family: UiFontFamily::default(),
            ui_font_name: None,
            ui_font_download_id: None,
            ui_font_file_path: None,
            ui_font_file_source_name: None,
            preview_capture_percent: default_preview_capture_percent(),
            developer_mode_enabled: false,
            default_queue_preset_id: None,
            parallelism_mode: None,
            max_parallel_jobs: None,
            max_parallel_cpu_jobs: None,
            max_parallel_hw_jobs: None,
            progress_update_interval_ms: None,
            metrics_interval_ms: None,
            taskbar_progress_mode: TaskbarProgressMode::default(),
            taskbar_progress_scope: TaskbarProgressScope::default(),
            queue_persistence_mode: QueuePersistenceMode::default(),
            crash_recovery_log_retention: None,
            onboarding_completed: false,
            selection_bar_pinned: false,
            queue_output_policy: OutputPolicy::default(),
        }
    }
}
