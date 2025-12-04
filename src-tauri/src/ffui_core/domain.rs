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
    /// Optional target video bitrate in kbps used for CBR/VBR/two-pass flows.
    pub bitrate_kbps: Option<i32>,
    /// Optional max video bitrate in kbps for capped VBR.
    pub max_bitrate_kbps: Option<i32>,
    /// Optional buffer size in kbits, mapped to `-bufsize`.
    pub buffer_size_kbits: Option<i32>,
    /// Two-pass encoding flag (1 or 2) when using `-pass`; None for single-pass.
    pub pass: Option<u8>,
    /// Optional encoder level string, e.g. "4.1".
    pub level: Option<String>,
    /// Optional GOP size mapped to `-g`.
    pub gop_size: Option<u32>,
    /// Optional B-frame count mapped to `-bf`.
    pub bf: Option<u32>,
    /// Optional pixel format mapped to `-pix_fmt`.
    pub pix_fmt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioConfig {
    pub codec: AudioCodecType,
    pub bitrate: Option<i32>,
    pub sample_rate_hz: Option<u32>,
    pub channels: Option<u32>,
    pub channel_layout: Option<String>,
    /// Optional loudness normalization profile applied via `loudnorm` in the
    /// audio filter chain. When None or "none", no loudness filter is added.
    pub loudness_profile: Option<String>,
    /// Optional target integrated loudness (LUFS) used when building the
    /// `loudnorm` expression. When None, profile defaults are used.
    pub target_lufs: Option<f64>,
    /// Optional target loudness range (LRA). When None, profile defaults
    /// derived from the FFmpeg loudness guidance are used.
    pub loudness_range: Option<f64>,
    /// Optional true-peak ceiling in dBTP. Values very close to 0dBTP are
    /// considered unsafe and may be clamped at call sites.
    pub true_peak_db: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterConfig {
    pub scale: Option<String>,
    pub crop: Option<String>,
    pub fps: Option<u32>,
    pub vf_chain: Option<String>,
    pub af_chain: Option<String>,
    pub filter_complex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OverwriteBehavior {
    Ask,
    Overwrite,
    NoOverwrite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalConfig {
    /// Whether to pass -y / -n to ffmpeg. When None, ffmpeg default
    /// behaviour is used and no explicit flag is emitted.
    pub overwrite_behavior: Option<OverwriteBehavior>,
    /// Optional ffmpeg -loglevel; when None we do not emit a flag.
    pub log_level: Option<String>,
    /// When true, add -hide_banner.
    pub hide_banner: Option<bool>,
    /// When true, add -report so ffmpeg writes a diagnostic log file.
    pub enable_report: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SeekMode {
    Input,
    Output,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DurationMode {
    Duration,
    To,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputTimelineConfig {
    pub seek_mode: Option<SeekMode>,
    pub seek_position: Option<String>,
    pub duration_mode: Option<DurationMode>,
    pub duration: Option<String>,
    pub accurate_seek: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingConfig {
    pub maps: Option<Vec<String>>,
    pub metadata: Option<Vec<String>>,
    pub dispositions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubtitleStrategy {
    Keep,
    Drop,
    BurnIn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitlesConfig {
    pub strategy: Option<SubtitleStrategy>,
    pub burn_in_filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerConfig {
    pub format: Option<String>,
    pub movflags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareConfig {
    pub hwaccel: Option<String>,
    pub hwaccel_device: Option<String>,
    pub hwaccel_output_format: Option<String>,
    pub bitstream_filters: Option<Vec<String>>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitMetadata {
    /// Last known overall progress percentage when the job was paused via a
    /// wait operation. This is expressed in the same 0-100 range as the
    /// `progress` field exposed in queue snapshots.
    pub last_progress_percent: Option<f64>,
    /// Approximate number of seconds already processed when the job was
    /// paused. When media duration is unknown this may be None.
    pub processed_seconds: Option<f64>,
    /// Path to a partial output segment or temporary output file, when
    /// available. This is intended for future crash-recovery and resume
    /// strategies; callers must tolerate it being absent.
    pub tmp_output_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Waiting,
    Queued,
    Processing,
    Paused,
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
    /// Stable execution priority within the waiting queue. Lower values are
    /// scheduled earlier. The frontend uses this for queue-mode ordering while
    /// treating it as metadata in display-only mode.
    #[serde(rename = "queueOrder")]
    pub queue_order: Option<u64>,
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
    /// Optional estimated processing time in seconds for this job. This is
    /// used for aggregated progress weighting (e.g. Windows taskbar) so
    /// small but heavy presets can contribute more accurately than size
    /// alone would suggest.
    pub estimated_seconds: Option<f64>,
    /// Optional preview image path for this job, typically a JPEG/PNG frame
    /// extracted from the input video and stored near the app data folder.
    pub preview_path: Option<String>,
    /// Bounded textual tail of stderr/stdout logs for this job, suitable
    /// for rendering in the task detail view without unbounded growth.
    pub log_tail: Option<String>,
    /// Short, structured reason string describing why a job failed. This is
    /// separate from raw logs so the UI can surface a concise headline.
    pub failure_reason: Option<String>,
    /// Optional stable identifier for a Smart Scan batch this job belongs to.
    /// Manual / ad-hoc jobs do not carry a batch id.
    pub batch_id: Option<String>,
    /// Optional metadata captured when a job is paused via an explicit wait
    /// operation or restored after an unexpected termination. This keeps the
    /// core `TranscodeJob` shape stable while allowing future resume/crash-
    /// recovery strategies to evolve.
    pub wait_metadata: Option<WaitMetadata>,
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
            queue_order: None,
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
            estimated_seconds: Some(300.0),
            preview_path: Some("C:/app-data/previews/abc123.jpg".to_string()),
            log_tail: Some("last few lines".to_string()),
            failure_reason: Some("ffmpeg exited with non-zero status (exit code 1)".to_string()),
            batch_id: Some("auto-compress-batch-1".to_string()),
            wait_metadata: None,
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
        assert_eq!(media.get("width").and_then(Value::as_u64).unwrap(), 1920u64);
        assert_eq!(
            media.get("height").and_then(Value::as_u64).unwrap(),
            1080u64
        );
        assert_eq!(
            media.get("frameRate").and_then(Value::as_f64).unwrap(),
            29.97
        );
        assert_eq!(
            media.get("videoCodec").and_then(Value::as_str).unwrap(),
            "h264"
        );
        assert_eq!(
            media.get("audioCodec").and_then(Value::as_str).unwrap(),
            "aac"
        );
        assert_eq!(media.get("sizeMB").and_then(Value::as_f64).unwrap(), 700.0);

        assert_eq!(
            value
                .get("estimatedSeconds")
                .and_then(Value::as_f64)
                .expect("estimatedSeconds present"),
            300.0
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
        assert_eq!(
            value
                .get("batchId")
                .and_then(Value::as_str)
                .expect("batchId present"),
            "auto-compress-batch-1"
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

    #[test]
    fn auto_compress_result_uses_camel_case_batch_fields() {
        let job = TranscodeJob {
            id: "1".to_string(),
            filename: "video.mp4".to_string(),
            job_type: JobType::Video,
            source: JobSource::SmartScan,
            queue_order: None,
            original_size_mb: 10.0,
            original_codec: Some("h264".to_string()),
            preset_id: "preset-1".to_string(),
            status: JobStatus::Completed,
            progress: 100.0,
            start_time: Some(1),
            end_time: Some(2),
            output_size_mb: Some(5.0),
            logs: Vec::new(),
            skip_reason: None,
            input_path: Some("C:/videos/input.mp4".to_string()),
            output_path: Some("C:/videos/output.mp4".to_string()),
            ffmpeg_command: None,
            media_info: None,
            estimated_seconds: None,
            preview_path: None,
            log_tail: None,
            failure_reason: None,
            batch_id: Some("auto-compress-batch-1".to_string()),
            wait_metadata: None,
        };

        let result = AutoCompressResult {
            root_path: "C:/videos".to_string(),
            jobs: vec![job],
            total_files_scanned: 1,
            total_candidates: 1,
            total_processed: 1,
            batch_id: "auto-compress-batch-1".to_string(),
            started_at_ms: 100,
            completed_at_ms: 200,
        };

        let value = serde_json::to_value(&result).expect("serialize AutoCompressResult");
        assert_eq!(
            value
                .get("batchId")
                .and_then(Value::as_str)
                .expect("batchId present"),
            "auto-compress-batch-1"
        );
        assert_eq!(
            value
                .get("startedAtMs")
                .and_then(Value::as_u64)
                .expect("startedAtMs present"),
            100
        );
        assert_eq!(
            value
                .get("completedAtMs")
                .and_then(Value::as_u64)
                .expect("completedAtMs present"),
            200
        );
    }

    #[test]
    fn auto_compress_progress_uses_camel_case_fields() {
        let progress = AutoCompressProgress {
            root_path: "C:/videos".to_string(),
            total_files_scanned: 10,
            total_candidates: 4,
            total_processed: 2,
            batch_id: "auto-compress-batch-1".to_string(),
        };

        let value = serde_json::to_value(&progress).expect("serialize AutoCompressProgress");
        assert_eq!(
            value
                .get("rootPath")
                .and_then(Value::as_str)
                .expect("rootPath present"),
            "C:/videos"
        );
        assert_eq!(
            value
                .get("totalFilesScanned")
                .and_then(Value::as_u64)
                .expect("totalFilesScanned present"),
            10
        );
        assert_eq!(
            value
                .get("totalCandidates")
                .and_then(Value::as_u64)
                .expect("totalCandidates present"),
            4
        );
        assert_eq!(
            value
                .get("totalProcessed")
                .and_then(Value::as_u64)
                .expect("totalProcessed present"),
            2
        );
        assert_eq!(
            value
                .get("batchId")
                .and_then(Value::as_str)
                .expect("batchId present"),
            "auto-compress-batch-1"
        );
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
