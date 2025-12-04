use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::transcoding::domain::{
    AudioCodecType, AudioConfig, EncoderType, FFmpegPreset, FilterConfig, ImageTargetFormat,
    PresetStats, RateControlMode, SmartScanConfig, VideoConfig,
};

fn executable_sidecar_path(suffix: &str) -> Result<PathBuf> {
    let exe = std::env::current_exe().context("failed to resolve current executable")?;
    let dir = exe
        .parent()
        .map(Path::to_path_buf)
        .context("failed to resolve executable directory")?;
    let stem = exe
        .file_stem()
        .and_then(|s| s.to_str())
        .context("failed to resolve executable stem")?;
    Ok(dir.join(format!("{stem}.{suffix}")))
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let file = fs::File::open(path)
        .with_context(|| format!("failed to open config file {}", path.display()))?;
    let reader = BufReader::new(file);
    serde_json::from_reader(reader)
        .with_context(|| format!("failed to parse JSON from {}", path.display()))
}

fn write_json_file<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<()> {
    let tmp_path = path.with_extension("tmp");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }
    let file = fs::File::create(&tmp_path)
        .with_context(|| format!("failed to create temp file {}", tmp_path.display()))?;
    serde_json::to_writer_pretty(&file, value)
        .with_context(|| format!("failed to write JSON to {}", tmp_path.display()))?;
    fs::rename(&tmp_path, path).with_context(|| {
        format!(
            "failed to atomically rename {} -> {}",
            tmp_path.display(),
            path.display()
        )
    })?;
    Ok(())
}

/// Persistent metadata about an auto-downloaded external tool binary. This is
/// stored in settings.json so the app can avoid repeated downloads and can
/// surface which version was installed from which source URL.
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

fn default_preview_capture_percent() -> u8 {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub tools: ExternalToolSettings,
    pub smart_scan_defaults: SmartScanConfig,
    #[serde(default = "default_preview_capture_percent")]
    pub preview_capture_percent: u8,
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
            default_queue_preset_id: None,
            max_parallel_jobs: None,
            progress_update_interval_ms: None,
            taskbar_progress_mode: TaskbarProgressMode::default(),
        }
    }
}

/// Built-in presets that should always be available, even on a fresh install
/// with no presets.json on disk. These are kept in sync with the frontend
/// INITIAL_PRESETS in src/MainApp.vue (ids p1 / p2).
fn default_presets() -> Vec<FFmpegPreset> {
    vec![
        FFmpegPreset {
            id: "p1".to_string(),
            name: "Universal 1080p".to_string(),
            description: "x264 Medium CRF 23. Standard for web.".to_string(),
            video: VideoConfig {
                encoder: EncoderType::Libx264,
                rate_control: RateControlMode::Crf,
                quality_value: 23,
                preset: "medium".to_string(),
                tune: None,
                profile: None,
                bitrate_kbps: None,
                max_bitrate_kbps: None,
                buffer_size_kbits: None,
                pass: None,
            },
            audio: AudioConfig {
                codec: AudioCodecType::Copy,
                bitrate: None,
            },
            filters: FilterConfig {
                scale: Some("-2:1080".to_string()),
                crop: None,
                fps: None,
            },
            stats: PresetStats {
                usage_count: 5,
                total_input_size_mb: 2500.0,
                total_output_size_mb: 800.0,
                total_time_seconds: 420.0,
            },
            advanced_enabled: Some(false),
            ffmpeg_template: None,
        },
        FFmpegPreset {
            id: "p2".to_string(),
            name: "Archive Master".to_string(),
            description: "x264 Slow CRF 18. Near lossless.".to_string(),
            video: VideoConfig {
                encoder: EncoderType::Libx264,
                rate_control: RateControlMode::Crf,
                quality_value: 18,
                preset: "slow".to_string(),
                tune: None,
                profile: None,
                bitrate_kbps: None,
                max_bitrate_kbps: None,
                buffer_size_kbits: None,
                pass: None,
            },
            audio: AudioConfig {
                codec: AudioCodecType::Copy,
                bitrate: None,
            },
            filters: FilterConfig {
                scale: None,
                crop: None,
                fps: None,
            },
            stats: PresetStats {
                usage_count: 2,
                total_input_size_mb: 5000.0,
                total_output_size_mb: 3500.0,
                total_time_seconds: 1200.0,
            },
            advanced_enabled: Some(false),
            ffmpeg_template: None,
        },
    ]
}

pub fn load_presets() -> Result<Vec<FFmpegPreset>> {
    let path = executable_sidecar_path("presets.json")?;
    // When there is no presets.json yet (fresh install), or when the file is
    // unreadable/empty, fall back to the built-in defaults so well-known
    // presets like "Universal 1080p" (id p1) are always present for the
    // transcoding engine.
    let mut presets = if !path.exists() {
        default_presets()
    } else {
        match read_json_file(&path) {
            Ok(existing) => existing,
            Err(err) => {
                eprintln!("failed to load presets from {}: {err:#}", path.display());
                default_presets()
            }
        }
    };

    // Ensure all built-in defaults exist at least once. This protects against
    // older installs that may have an empty or partial presets.json on disk.
    for builtin in default_presets() {
        if !presets.iter().any(|p| p.id == builtin.id) {
            presets.push(builtin);
        }
    }

    Ok(presets)
}

pub fn save_presets(presets: &[FFmpegPreset]) -> Result<()> {
    let path = executable_sidecar_path("presets.json")?;
    write_json_file(&path, presets)
}

pub fn load_settings() -> Result<AppSettings> {
    let path = executable_sidecar_path("settings.json")?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    read_json_file(&path)
}

pub fn save_settings(settings: &AppSettings) -> Result<()> {
    let path = executable_sidecar_path("settings.json")?;
    write_json_file(&path, settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::fs;

    #[test]
    fn load_presets_provides_defaults_when_file_missing_or_empty() {
        // Reconstruct the sidecar path in the same way as executable_sidecar_path.
        let exe = std::env::current_exe().expect("resolve current_exe for test");
        let dir = exe.parent().expect("exe has parent directory");
        let stem = exe
            .file_stem()
            .and_then(|s| s.to_str())
            .expect("exe has valid UTF-8 stem");
        let path = dir.join(format!("{stem}.presets.json"));

        // Ensure we start from a clean state with no presets.json.
        let _ = fs::remove_file(&path);

        let presets = load_presets().expect("load_presets should succeed without file");
        assert!(
            !presets.is_empty(),
            "default_presets should be returned when presets file is missing"
        );
        assert!(
            presets.iter().any(|p| p.id == "p1"),
            "defaults must include Universal 1080p with id 'p1'"
        );

        // If an empty presets.json exists, we should still fall back to defaults.
        fs::write(&path, "[]").expect("write empty presets file");
        let presets2 = load_presets().expect("load_presets should succeed with empty file");
        assert!(
            !presets2.is_empty(),
            "defaults should also be injected when presets.json contains an empty array"
        );
        assert!(
            presets2.iter().any(|p| p.id == "p1"),
            "defaults must still include id 'p1' when file is empty"
        );

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn app_settings_default_uses_preview_capture_percent_25() {
        let settings = AppSettings::default();
        assert_eq!(
            settings.preview_capture_percent, 25,
            "default preview_capture_percent must be 25"
        );
        assert!(
            settings.max_parallel_jobs.is_none(),
            "default max_parallel_jobs must be None so the engine can auto-derive concurrency"
        );
        assert!(
            settings.progress_update_interval_ms.is_none(),
            "default progress_update_interval_ms must be None so the engine can choose a stable default"
        );
        assert_eq!(
            settings.taskbar_progress_mode,
            TaskbarProgressMode::ByEstimatedTime,
            "default taskbar_progress_mode should prefer estimated-time weighting"
        );
    }

    #[test]
    fn app_settings_serializes_preview_capture_percent_as_camel_case() {
        let settings = AppSettings::default();
        let value = serde_json::to_value(&settings).expect("serialize AppSettings");

        let percent = value
            .get("previewCapturePercent")
            .and_then(Value::as_u64)
            .expect("previewCapturePercent field present as u64");
        assert_eq!(percent, 25);

        // When default_queue_preset_id is None it should be omitted from JSON
        // to keep settings.json minimal.
        assert!(
            value.get("defaultQueuePresetId").is_none(),
            "defaultQueuePresetId should be absent when unset"
        );

        // When max_parallel_jobs is None it should be omitted from JSON so
        // existing settings files remain minimal.
        assert!(
            value.get("maxParallelJobs").is_none(),
            "maxParallelJobs should be absent when unset"
        );

        // When progress_update_interval_ms is None it should be omitted from JSON
        // so existing settings files remain minimal.
        assert!(
            value.get("progressUpdateIntervalMs").is_none(),
            "progressUpdateIntervalMs should be absent when unset"
        );

        let mode = value
            .get("taskbarProgressMode")
            .and_then(Value::as_str)
            .expect("taskbarProgressMode present as string");
        assert_eq!(
            mode, "byEstimatedTime",
            "taskbarProgressMode must serialize as a camelCase string"
        );

        // When no tools have been auto-downloaded yet, the nested metadata
        // object should be absent so existing settings.json files stay minimal.
        let tools = value
            .get("tools")
            .and_then(Value::as_object)
            .expect("tools field present as object");
        assert!(
            !tools.contains_key("downloaded"),
            "tools.downloaded should be omitted when no download metadata is recorded"
        );
    }

    #[test]
    fn app_settings_deserializes_missing_preview_capture_percent_with_default() {
        // Simulate legacy JSON without the new previewCapturePercent field.
        let legacy = json!({
            "tools": {
                "ffmpegPath": null,
                "ffprobePath": null,
                "avifencPath": null,
                "autoDownload": false,
                "autoUpdate": false
            },
            "smartScanDefaults": {
                "minImageSizeKB": 50,
                "minVideoSizeMB": 50,
                "minSavingRatio": 0.95,
                "imageTargetFormat": "avif",
                "videoPresetId": ""
            },
            "maxParallelJobs": 3
        });

        let decoded: AppSettings = serde_json::from_value(legacy)
            .expect("deserialize AppSettings without previewCapturePercent");
        assert_eq!(
            decoded.preview_capture_percent, 25,
            "missing previewCapturePercent must default to 25 for backwards compatibility"
        );
        assert_eq!(
            decoded.max_parallel_jobs,
            Some(3),
            "maxParallelJobs must deserialize from camelCase JSON field"
        );

        assert_eq!(
            decoded.taskbar_progress_mode,
            TaskbarProgressMode::ByEstimatedTime,
            "missing taskbarProgressMode must default to ByEstimatedTime for backwards compatibility"
        );

        // Legacy JSON without progressUpdateIntervalMs should transparently
        // default to None so the engine can apply DEFAULT_PROGRESS_UPDATE_INTERVAL_MS.
        assert!(
            decoded.progress_update_interval_ms.is_none(),
            "legacy settings without progressUpdateIntervalMs must decode with progress_update_interval_ms = None"
        );

        // Legacy JSON without tools.downloaded should transparently default to
        // an empty metadata map.
        assert!(
            decoded.tools.downloaded.is_none(),
            "legacy settings without tools.downloaded must decode with downloaded = None"
        );
    }

    #[test]
    fn app_settings_round_trips_downloaded_tool_metadata() {
        let mut settings = AppSettings::default();
        settings.tools.downloaded = Some(DownloadedToolState {
            ffmpeg: Some(DownloadedToolInfo {
                version: Some("6.1".to_string()),
                tag: Some("b6.1".to_string()),
                source_url: Some(
                    "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1/ffmpeg-win32-x64"
                        .to_string(),
                ),
                downloaded_at: Some(1_735_000_000_000),
            }),
            ffprobe: None,
            avifenc: None,
        });

        let json = serde_json::to_value(&settings).expect("serialize AppSettings with metadata");
        let tools = json
            .get("tools")
            .and_then(Value::as_object)
            .expect("tools field present as object");
        let downloaded = tools
            .get("downloaded")
            .and_then(Value::as_object)
            .expect("tools.downloaded present when metadata is set");
        let ffmpeg = downloaded
            .get("ffmpeg")
            .and_then(Value::as_object)
            .expect("downloaded.ffmpeg present");

        assert_eq!(ffmpeg.get("version").and_then(Value::as_str), Some("6.1"));
        assert_eq!(ffmpeg.get("tag").and_then(Value::as_str), Some("b6.1"));

        // JSON should deserialize back to the same structure so callers can
        // rely on settings.json as the single source of truth.
        let decoded: AppSettings =
            serde_json::from_value(json).expect("round-trip deserialize AppSettings");
        let decoded_meta = decoded
            .tools
            .downloaded
            .and_then(|state| state.ffmpeg)
            .expect("decoded.tools.downloaded.ffmpeg present");
        assert_eq!(decoded_meta.version.as_deref(), Some("6.1"));
        assert_eq!(decoded_meta.tag.as_deref(), Some("b6.1"));
    }
}
