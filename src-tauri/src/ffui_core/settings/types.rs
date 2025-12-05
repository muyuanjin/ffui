use serde::{Deserialize, Serialize};

use crate::ffui_core::domain::{ImageTargetFormat, SmartScanConfig};

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

fn is_false(value: &bool) -> bool {
    !*value
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
    /// Aggregation mode for computing taskbar progress from the queue. When
    /// omitted in existing settings.json files, this defaults to an
    /// estimated-time based mode for better weighting of heavy presets.
    pub taskbar_progress_mode: TaskbarProgressMode,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            tools: ExternalToolSettings::default(),
            smart_scan_defaults: SmartScanConfig {
                min_image_size_kb: 50,
                min_video_size_mb: 50,
                min_saving_ratio: 0.95,
                image_target_format: ImageTargetFormat::Avif,
                video_preset_id: String::new(),
            },
            preview_capture_percent: default_preview_capture_percent(),
            developer_mode_enabled: false,
            default_queue_preset_id: None,
            max_parallel_jobs: None,
            progress_update_interval_ms: None,
            taskbar_progress_mode: TaskbarProgressMode::default(),
        }
    }
}
