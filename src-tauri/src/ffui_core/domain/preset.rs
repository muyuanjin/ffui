use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::config::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetStats {
    pub usage_count: u64,
    // Keep TS field name `totalInputSizeMB` while still accepting the older
    // `totalInputSizeMb` variant from existing JSON on disk.
    #[serde(rename = "totalInputSizeMB", alias = "totalInputSizeMb")]
    pub total_input_size_mb: f64,
    // Same for `totalOutputSizeMB` vs `totalOutputSizeMb`.
    #[serde(rename = "totalOutputSizeMB", alias = "totalOutputSizeMb")]
    pub total_output_size_mb: f64,
    pub total_time_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FFmpegPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub description_i18n: Option<HashMap<String, String>>,
    pub global: Option<GlobalConfig>,
    pub input: Option<InputTimelineConfig>,
    pub mapping: Option<MappingConfig>,
    pub video: VideoConfig,
    pub audio: AudioConfig,
    pub filters: FilterConfig,
    pub subtitles: Option<SubtitlesConfig>,
    pub container: Option<ContainerConfig>,
    pub hardware: Option<HardwareConfig>,
    pub stats: PresetStats,
    pub advanced_enabled: Option<bool>,
    pub ffmpeg_template: Option<String>,
    /// 标记该预设是否为智能推荐预设（用户修改参数后会被清除）
    pub is_smart_preset: Option<bool>,
}
