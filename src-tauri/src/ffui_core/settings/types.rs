use serde::{Deserialize, Serialize};

use crate::ffui_core::domain::{
    FileTypeFilter, ImageTargetFormat, SavingConditionType, SmartScanConfig,
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

fn is_false(value: &bool) -> bool {
    !*value
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
    /// Persist queue snapshots to a sidecar JSON file and restore them on
    /// startup for crash recovery. This may keep large logs on disk.
    CrashRecovery,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub tools: ExternalToolSettings,
    pub smart_scan_defaults: SmartScanConfig,
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
    /// Optional upper bound for concurrent transcoding jobs. When None or 0,
    /// the engine derives a conservative default based on available cores.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_parallel_jobs: Option<u8>,
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
    /// One-time onboarding completion marker. When true, the smart preset /
    /// tools onboarding flow will not auto-run again on startup.
    #[serde(default, skip_serializing_if = "is_false")]
    pub onboarding_completed: bool,
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
            },
            preview_capture_percent: default_preview_capture_percent(),
            developer_mode_enabled: false,
            default_queue_preset_id: None,
            max_parallel_jobs: None,
            progress_update_interval_ms: None,
            metrics_interval_ms: None,
            taskbar_progress_mode: TaskbarProgressMode::default(),
            taskbar_progress_scope: TaskbarProgressScope::default(),
            queue_persistence_mode: QueuePersistenceMode::default(),
            onboarding_completed: false,
        }
    }
}
