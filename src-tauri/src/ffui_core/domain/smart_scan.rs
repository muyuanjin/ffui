use serde::{Deserialize, Serialize};

use super::job::TranscodeJob;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartScanConfig {
    #[serde(rename = "minImageSizeKB")]
    pub min_image_size_kb: u64,
    #[serde(rename = "minVideoSizeMB")]
    pub min_video_size_mb: u64,
    #[serde(rename = "minSavingRatio")]
    pub min_saving_ratio: f64,
    #[serde(rename = "imageTargetFormat")]
    pub image_target_format: ImageTargetFormat,
    #[serde(rename = "videoPresetId")]
    pub video_preset_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageTargetFormat {
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
