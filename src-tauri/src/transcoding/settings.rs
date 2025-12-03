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
    let tmp_path = path.with_extension("json.tmp");
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ExternalToolSettings {
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub avifenc_path: Option<String>,
    pub auto_download: bool,
    pub auto_update: bool,
}

fn default_preview_capture_percent() -> u8 {
    25
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub tools: ExternalToolSettings,
    pub smart_scan_defaults: SmartScanConfig,
    #[serde(default = "default_preview_capture_percent")]
    pub preview_capture_percent: u8,
    /// Optional upper bound for concurrent transcoding jobs. When None or 0,
    /// the engine derives a conservative default based on available cores.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_parallel_jobs: Option<u8>,
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
            max_parallel_jobs: None,
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

        // When max_parallel_jobs is None it should be omitted from JSON so
        // existing settings files remain minimal.
        assert!(
            value.get("maxParallelJobs").is_none(),
            "maxParallelJobs should be absent when unset"
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
    }
}
