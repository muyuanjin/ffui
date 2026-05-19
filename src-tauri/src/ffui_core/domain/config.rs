use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EncoderType {
    Libx264,
    Libx265,
    HevcNvenc,
    H264Nvenc,
    Av1Nvenc,
    HevcQsv,
    Av1Qsv,
    HevcAmf,
    Av1Amf,
    LibSvtAv1,
    Copy,
    Unknown(String),
}

impl EncoderType {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Libx264 => "libx264",
            Self::Libx265 => "libx265",
            Self::HevcNvenc => "hevc_nvenc",
            Self::H264Nvenc => "h264_nvenc",
            Self::Av1Nvenc => "av1_nvenc",
            Self::HevcQsv => "hevc_qsv",
            Self::Av1Qsv => "av1_qsv",
            Self::HevcAmf => "hevc_amf",
            Self::Av1Amf => "av1_amf",
            Self::LibSvtAv1 => "libsvtav1",
            Self::Copy => "copy",
            Self::Unknown(value) => value.as_str(),
        }
    }

    pub fn is_copy(&self) -> bool {
        matches!(self, Self::Copy)
    }
}

impl Serialize for EncoderType {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for EncoderType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "libx264" => Self::Libx264,
            "libx265" => Self::Libx265,
            "hevc_nvenc" => Self::HevcNvenc,
            "h264_nvenc" => Self::H264Nvenc,
            "av1_nvenc" => Self::Av1Nvenc,
            "hevc_qsv" => Self::HevcQsv,
            "av1_qsv" => Self::Av1Qsv,
            "hevc_amf" => Self::HevcAmf,
            "av1_amf" => Self::Av1Amf,
            "libsvtav1" => Self::LibSvtAv1,
            "copy" => Self::Copy,
            _ => Self::Unknown(value),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioCodecType {
    #[serde(rename = "copy")]
    Copy,
    #[serde(rename = "aac")]
    Aac,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RateControlMode {
    Crf,
    Cq,
    Constqp,
    Cbr,
    Vbr,
    Unknown(String),
}

impl RateControlMode {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Crf => "crf",
            Self::Cq => "cq",
            Self::Constqp => "constqp",
            Self::Cbr => "cbr",
            Self::Vbr => "vbr",
            Self::Unknown(value) => value.as_str(),
        }
    }

    pub fn is_bitrate_mode(&self) -> bool {
        matches!(self, Self::Cbr | Self::Vbr)
    }

    pub fn is_known(&self) -> bool {
        !matches!(self, Self::Unknown(_))
    }
}

impl Serialize for RateControlMode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for RateControlMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "crf" => Self::Crf,
            "cq" => Self::Cq,
            "constqp" => Self::Constqp,
            "cbr" => Self::Cbr,
            "vbr" => Self::Vbr,
            _ => Self::Unknown(value),
        })
    }
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
    /// Optional NVENC `b_ref_mode` value.
    pub b_ref_mode: Option<String>,
    /// Optional lookahead depth mapped to `-rc-lookahead`.
    pub rc_lookahead: Option<u32>,
    /// Optional spatial AQ toggle mapped to `-spatial-aq`.
    pub spatial_aq: Option<bool>,
    /// Optional temporal AQ toggle mapped to `-temporal-aq`.
    pub temporal_aq: Option<bool>,
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
    /// derived from the `FFmpeg` loudness guidance are used.
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
    pub fps: Option<f64>,
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
    /// When true, add `-hide_banner`.
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
    /// Loop input N times via -stream_loop. 0 = no loop, -1 = infinite.
    pub stream_loop: Option<i32>,
    /// Apply input timestamp offset via -itsoffset (time duration syntax).
    pub input_time_offset: Option<String>,
    pub duration_mode: Option<DurationMode>,
    pub duration: Option<String>,
    pub accurate_seek: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingConfig {
    pub maps: Option<Vec<String>>,
    /// Control metadata copying via -map_metadata. -1 disables automatic copy.
    pub map_metadata_from_input_file_index: Option<i32>,
    /// Control chapter copying via -map_chapters. -1 disables chapter copy.
    pub map_chapters_from_input_file_index: Option<i32>,
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
