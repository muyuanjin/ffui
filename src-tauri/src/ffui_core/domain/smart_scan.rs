use serde::{Deserialize, Serialize};

use super::job::TranscodeJob;

/// 保留结果的条件类型
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SavingConditionType {
    /// 按压缩率判断
    #[default]
    Ratio,
    /// 按绝对节省空间判断
    AbsoluteSize,
}

/// 文件类型筛选配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTypeFilter {
    /// 是否启用该类型
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 具体的文件扩展名（不含点号），如 ["mp4", "mkv"]
    #[serde(default)]
    pub extensions: Vec<String>,
}

fn default_true() -> bool {
    true
}

impl Default for FileTypeFilter {
    fn default() -> Self {
        Self {
            enabled: true,
            extensions: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartScanConfig {
    /// 扫描根路径（可选，前端可能通过其他方式传递）
    #[serde(default)]
    pub root_path: Option<String>,

    /// 是否替换原文件（默认 true）
    #[serde(default = "default_true")]
    pub replace_original: bool,

    #[serde(rename = "minImageSizeKB")]
    pub min_image_size_kb: u64,

    #[serde(rename = "minVideoSizeMB")]
    pub min_video_size_mb: u64,

    /// 音频最小检测体积 (KB)
    #[serde(rename = "minAudioSizeKB", default = "default_audio_size_kb")]
    pub min_audio_size_kb: u64,

    /// 保留结果的条件类型
    #[serde(default)]
    pub saving_condition_type: SavingConditionType,

    #[serde(rename = "minSavingRatio")]
    pub min_saving_ratio: f64,

    /// 保留结果所需的最低节省空间 (MB)
    #[serde(rename = "minSavingAbsoluteMB", default = "default_saving_absolute_mb")]
    pub min_saving_absolute_mb: f64,

    #[serde(rename = "imageTargetFormat")]
    pub image_target_format: ImageTargetFormat,

    #[serde(rename = "videoPresetId")]
    pub video_preset_id: String,

    /// 音频转码预设 ID（可选）
    #[serde(rename = "audioPresetId", default)]
    pub audio_preset_id: Option<String>,

    /// 视频文件类型筛选
    #[serde(default)]
    pub video_filter: FileTypeFilter,

    /// 图片文件类型筛选
    #[serde(default)]
    pub image_filter: FileTypeFilter,

    /// 音频文件类型筛选
    #[serde(default = "default_audio_filter")]
    pub audio_filter: FileTypeFilter,
}

impl Default for SmartScanConfig {
    fn default() -> Self {
        Self {
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
            video_filter: FileTypeFilter::default(),
            image_filter: FileTypeFilter::default(),
            audio_filter: default_audio_filter(),
        }
    }
}

fn default_audio_size_kb() -> u64 {
    500
}

fn default_saving_absolute_mb() -> f64 {
    5.0
}

fn default_audio_filter() -> FileTypeFilter {
    FileTypeFilter {
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
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ImageTargetFormat {
    #[default]
    Avif,
    Webp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCompressResult {
    pub root_path: String,
    pub jobs: Vec<TranscodeJob>,
    pub total_files_scanned: u64,
    pub total_candidates: u64,
    pub total_processed: u64,
    /// Stable identifier for this Smart Scan batch so the frontend can group
    /// child jobs into a composite task.
    pub batch_id: String,
    /// Milliseconds since UNIX epoch when this batch scan started.
    pub started_at_ms: u64,
    /// Milliseconds since UNIX epoch when this batch scan completed.
    pub completed_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCompressProgress {
    pub root_path: String,
    pub total_files_scanned: u64,
    pub total_candidates: u64,
    pub total_processed: u64,
    pub batch_id: String,
}
