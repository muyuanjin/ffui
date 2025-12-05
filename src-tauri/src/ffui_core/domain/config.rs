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
