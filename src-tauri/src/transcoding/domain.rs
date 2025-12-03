use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EncoderType {
    #[serde(rename = "libx264")]
    Libx264,
    #[serde(rename = "hevc_nvenc")]
    HevcNvenc,
    #[serde(rename = "libsvtav1")]
    LibSvtAv1,
    #[serde(rename = "copy")]
    Copy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioCodecType {
    #[serde(rename = "copy")]
    Copy,
    #[serde(rename = "aac")]
    Aac,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RateControlMode {
    Crf,
    Cq,
    Cbr,
    Vbr,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoConfig {
    pub encoder: EncoderType,
    pub rate_control: RateControlMode,
    pub quality_value: i32,
    pub preset: String,
    pub tune: Option<String>,
    pub profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioConfig {
    pub codec: AudioCodecType,
    pub bitrate: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterConfig {
    pub scale: Option<String>,
    pub crop: Option<String>,
    pub fps: Option<u32>,
}

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
    pub video: VideoConfig,
    pub audio: AudioConfig,
    pub filters: FilterConfig,
    pub stats: PresetStats,
    pub advanced_enabled: Option<bool>,
    pub ffmpeg_template: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Waiting,
    Queued,
    Processing,
    Completed,
    Failed,
    Skipped,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobType {
    Video,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobSource {
    Manual,
    SmartScan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub duration_seconds: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub frame_rate: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    // Align with TS field name `sizeMB` but accept a legacy `sizeMb` variant
    // if we ever persisted older JSON on disk.
    #[serde(rename = "sizeMB", alias = "sizeMb")]
    pub size_mb: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeJob {
    pub id: String,
    pub filename: String,
    #[serde(rename = "type")]
    pub job_type: JobType,
    pub source: JobSource,
    // Align with TS field name `originalSizeMB` but accept legacy
    // `originalSizeMb` when deserializing.
    #[serde(rename = "originalSizeMB", alias = "originalSizeMb")]
    pub original_size_mb: f64,
    pub original_codec: Option<String>,
    pub preset_id: String,
    pub status: JobStatus,
    pub progress: f64,
    pub start_time: Option<u64>,
    pub end_time: Option<u64>,
    // Align with TS field name `outputSizeMB` but accept legacy
    // `outputSizeMb` when deserializing.
    #[serde(rename = "outputSizeMB", alias = "outputSizeMb")]
    pub output_size_mb: Option<f64>,
    /// Rolling window of recent log lines for this job. The UI uses this to
    /// display progressive output and debugging details.
    pub logs: Vec<String>,
    pub skip_reason: Option<String>,
    /// Absolute input path for this job. For newly created jobs this is
    /// always populated, but it is optional at the serde level to remain
    /// compatible with any legacy JSON that does not carry it.
    pub input_path: Option<String>,
    /// Planned or final output path for this job. For video transcodes this
    /// points at the `.compressed.*` target, even before the file exists.
    pub output_path: Option<String>,
    /// Human-readable ffmpeg command line used for this job, with quoted
    /// arguments so it can be copy/pasted from the UI.
    pub ffmpeg_command: Option<String>,
    /// Compact media metadata derived from ffprobe or existing job fields.
    pub media_info: Option<MediaInfo>,
    /// Optional preview image path for this job, typically a JPEG/PNG frame
    /// extracted from the input video and stored near the app data folder.
    pub preview_path: Option<String>,
    /// Bounded textual tail of stderr/stdout logs for this job, suitable
    /// for rendering in the task detail view without unbounded growth.
    pub log_tail: Option<String>,
    /// Short, structured reason string describing why a job failed. This is
    /// separate from raw logs so the UI can surface a concise headline.
    pub failure_reason: Option<String>,
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn transcode_job_uses_stable_mb_field_names_and_aliases() {
        let job = TranscodeJob {
            id: "1".to_string(),
            filename: "video.mp4".to_string(),
            job_type: JobType::Video,
            source: JobSource::Manual,
            original_size_mb: 123.0,
            original_codec: Some("h264".to_string()),
            preset_id: "preset-1".to_string(),
            status: JobStatus::Waiting,
            progress: 0.0,
            start_time: Some(1),
            end_time: Some(2),
            output_size_mb: Some(45.0),
            logs: Vec::new(),
            skip_reason: None,
            input_path: Some("C:/videos/input.mp4".to_string()),
            output_path: Some("C:/videos/output.mp4".to_string()),
            ffmpeg_command: Some(
                "ffmpeg -i \"C:/videos/input.mp4\" -c:v libx264 -crf 23 OUTPUT".to_string(),
            ),
            media_info: Some(MediaInfo {
                duration_seconds: Some(120.5),
                width: Some(1920),
                height: Some(1080),
                frame_rate: Some(29.97),
                video_codec: Some("h264".to_string()),
                audio_codec: Some("aac".to_string()),
                size_mb: Some(700.0),
            }),
            preview_path: Some("C:/app-data/previews/abc123.jpg".to_string()),
            log_tail: Some("last few lines".to_string()),
            failure_reason: Some("ffmpeg exited with non-zero status (exit code 1)".to_string()),
        };

        let value = serde_json::to_value(&job).expect("serialize TranscodeJob");
        assert_eq!(
            value.get("originalSizeMB").and_then(Value::as_f64).unwrap(),
            123.0
        );
        assert!(value.get("originalSizeMb").is_none());

        assert_eq!(
            value.get("outputSizeMB").and_then(Value::as_f64).unwrap(),
            45.0
        );
        assert!(value.get("outputSizeMb").is_none());

        // New optional inspection fields must use stable camelCase names.
        assert_eq!(
            value
                .get("inputPath")
                .and_then(Value::as_str)
                .expect("inputPath present"),
            "C:/videos/input.mp4"
        );
        assert_eq!(
            value
                .get("outputPath")
                .and_then(Value::as_str)
                .expect("outputPath present"),
            "C:/videos/output.mp4"
        );
        assert_eq!(
            value
                .get("ffmpegCommand")
                .and_then(Value::as_str)
                .expect("ffmpegCommand present"),
            "ffmpeg -i \"C:/videos/input.mp4\" -c:v libx264 -crf 23 OUTPUT"
        );

        let media = value
            .get("mediaInfo")
            .and_then(Value::as_object)
            .expect("mediaInfo object");
        assert_eq!(
            media
                .get("durationSeconds")
                .and_then(Value::as_f64)
                .unwrap(),
            120.5
        );
        assert_eq!(
            media.get("width").and_then(Value::as_u64).unwrap(),
            1920u64
        );
        assert_eq!(
            media.get("height").and_then(Value::as_u64).unwrap(),
            1080u64
        );
        assert_eq!(
            media
                .get("frameRate")
                .and_then(Value::as_f64)
                .unwrap(),
            29.97
        );
        assert_eq!(
            media
                .get("videoCodec")
                .and_then(Value::as_str)
                .unwrap(),
            "h264"
        );
        assert_eq!(
            media
                .get("audioCodec")
                .and_then(Value::as_str)
                .unwrap(),
            "aac"
        );
        assert_eq!(
            media.get("sizeMB").and_then(Value::as_f64).unwrap(),
            700.0
        );

        assert_eq!(
            value
                .get("previewPath")
                .and_then(Value::as_str)
                .expect("previewPath present"),
            "C:/app-data/previews/abc123.jpg"
        );
        assert_eq!(
            value
                .get("logTail")
                .and_then(Value::as_str)
                .expect("logTail present"),
            "last few lines"
        );
        assert_eq!(
            value
                .get("failureReason")
                .and_then(Value::as_str)
                .expect("failureReason present"),
            "ffmpeg exited with non-zero status (exit code 1)"
        );

        // Legacy JSON using *Mb fields must still deserialize correctly.
        let legacy_json = json!({
            "id": "legacy",
            "filename": "legacy.mp4",
            "type": "video",
            "source": "manual",
            "originalSizeMb": 50.0,
            "originalCodec": "h264",
            "presetId": "preset-1",
            "status": "waiting",
            "progress": 0.0,
            "logs": [],
        });
        let decoded: TranscodeJob =
            serde_json::from_value(legacy_json).expect("deserialize legacy TranscodeJob");
        assert_eq!(decoded.original_size_mb, 50.0);
    }

    #[test]
    fn preset_stats_uses_stable_mb_field_names_and_aliases() {
        let stats = PresetStats {
            usage_count: 1,
            total_input_size_mb: 100.0,
            total_output_size_mb: 50.0,
            total_time_seconds: 10.0,
        };

        let value = serde_json::to_value(&stats).expect("serialize PresetStats");
        assert_eq!(
            value
                .get("totalInputSizeMB")
                .and_then(Value::as_f64)
                .unwrap(),
            100.0
        );
        assert!(value.get("totalInputSizeMb").is_none());

        assert_eq!(
            value
                .get("totalOutputSizeMB")
                .and_then(Value::as_f64)
                .unwrap(),
            50.0
        );
        assert!(value.get("totalOutputSizeMb").is_none());

        let legacy_json = json!({
            "usageCount": 2,
            "totalInputSizeMb": 200.0,
            "totalOutputSizeMb": 80.0,
            "totalTimeSeconds": 20.0,
        });
        let decoded: PresetStats =
            serde_json::from_value(legacy_json).expect("deserialize legacy PresetStats");
        assert_eq!(decoded.total_input_size_mb, 200.0);
        assert_eq!(decoded.total_output_size_mb, 80.0);
        assert_eq!(decoded.usage_count, 2);
        assert_eq!(decoded.total_time_seconds, 20.0);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueState {
    pub jobs: Vec<TranscodeJob>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCompressResult {
    pub root_path: String,
    pub jobs: Vec<TranscodeJob>,
    pub total_files_scanned: u64,
    pub total_candidates: u64,
    pub total_processed: u64,
}
