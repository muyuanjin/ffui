use super::JobType;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum OutputContainerPolicy {
    /// Follow the preset (structured) or the advanced template when present.
    #[serde(rename = "default")]
    #[default]
    Default,
    /// Force the output container to match the input file's extension.
    #[serde(rename = "keepInput")]
    KeepInput,
    /// Force the output container to an explicit format (e.g. mkv/mp4).
    #[serde(rename = "force")]
    Force { format: String },
    ByMedia {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        video: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        audio: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        image: Option<String>,
    },
}

pub fn media_type_for_extension(extension: &str) -> JobType {
    match extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "mkv" | "matroska" | "mov" | "avi" | "flv" | "ts" | "m2ts" | "mpegts" | "wmv"
        | "asf" | "webm" | "m4v" | "mxf" | "3gp" | "rm" | "rmvb" | "hls" | "m3u8" | "dash"
        | "mpd" => JobType::Video,
        "mp3" | "wav" | "flac" | "aac" | "adts" | "ogg" | "m4a" | "wma" | "opus" | "aiff"
        | "aif" | "ac3" => JobType::Audio,
        "jpg" | "jpeg" | "png" | "bmp" | "tif" | "tiff" | "webp" | "avif" => JobType::Image,
        _ => JobType::Other,
    }
}

impl OutputContainerPolicy {
    pub fn for_media_type(&self, media_type: JobType) -> Self {
        let Self::ByMedia {
            video,
            audio,
            image,
        } = self
        else {
            return self.clone();
        };
        let format = match media_type {
            JobType::Video => video,
            JobType::Audio => audio,
            JobType::Image => image,
            JobType::Other => return Self::Default,
        };
        format.as_ref().map_or(Self::Default, |format| Self::Force {
            format: format.clone(),
        })
    }

    pub fn scoped_for_active_settings(&self) -> Self {
        let Self::Force { format } = self else {
            return self.clone();
        };
        let mut scoped = Self::ByMedia {
            video: None,
            audio: None,
            image: None,
        };
        if let Self::ByMedia {
            video,
            audio,
            image,
        } = &mut scoped
        {
            let target = match media_type_for_extension(format) {
                JobType::Video => video,
                JobType::Audio => audio,
                JobType::Image => image,
                JobType::Other => return self.clone(),
            };
            *target = Some(format.clone());
        }
        scoped
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum OutputDirectoryPolicy {
    #[serde(rename = "sameAsInput")]
    #[default]
    SameAsInput,
    #[serde(rename = "fixed")]
    Fixed { directory: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutputFilenameRegexReplace {
    pub pattern: String,
    pub replacement: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum OutputFilenameAppend {
    /// The literal suffix string in `OutputFilenamePolicy::suffix`.
    Suffix,
    Timestamp,
    EncoderQuality,
    Random,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OutputFilenamePolicy {
    /// Optional string prepended to the filename stem.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    /// Optional string appended to the filename stem.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    /// Optional regex replace applied to the stem.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regex_replace: Option<OutputFilenameRegexReplace>,
    /// When true, append a local timestamp suffix `YYYYMMDD-HHmmss`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub append_timestamp: bool,
    /// When true, append an encoder+quality tag when it can be inferred.
    #[serde(default, skip_serializing_if = "is_false")]
    pub append_encoder_quality: bool,
    /// Optional fixed length of random hex characters appended to the stem.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub random_suffix_len: Option<u8>,
    /// Controls the append order when multiple suffix-like options are enabled.
    #[serde(
        default = "default_output_filename_append_order",
        skip_serializing_if = "is_default_output_filename_append_order"
    )]
    pub append_order: Vec<OutputFilenameAppend>,
}

#[allow(clippy::trivially_copy_pass_by_ref)]
const fn is_false(v: &bool) -> bool {
    !*v
}

fn default_output_filename_append_order() -> Vec<OutputFilenameAppend> {
    vec![
        OutputFilenameAppend::Suffix,
        OutputFilenameAppend::Timestamp,
        OutputFilenameAppend::EncoderQuality,
        OutputFilenameAppend::Random,
    ]
}

fn is_default_output_filename_append_order(order: &Vec<OutputFilenameAppend>) -> bool {
    *order == default_output_filename_append_order()
}

impl Default for OutputFilenamePolicy {
    fn default() -> Self {
        Self {
            prefix: None,
            suffix: Some(".compressed".to_string()),
            regex_replace: None,
            append_timestamp: false,
            append_encoder_quality: false,
            random_suffix_len: None,
            append_order: default_output_filename_append_order(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Type, PartialEq, Eq)]
#[serde(untagged)]
pub enum PreserveFileTimesPolicy {
    /// Backward-compatible mode: true = preserve all, false = preserve none.
    Bool(bool),
    /// Fine-grained preservation.
    Detailed {
        #[serde(default)]
        created: bool,
        #[serde(default)]
        modified: bool,
        #[serde(default)]
        accessed: bool,
    },
}

impl<'de> Deserialize<'de> for PreserveFileTimesPolicy {
    fn deserialize<Deserializer>(deserializer: Deserializer) -> Result<Self, Deserializer::Error>
    where
        Deserializer: serde::Deserializer<'de>,
    {
        struct PolicyVisitor;

        impl<'de> serde::de::Visitor<'de> for PolicyVisitor {
            type Value = PreserveFileTimesPolicy;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a boolean or file time preservation options")
            }

            fn visit_bool<Error>(self, value: bool) -> Result<Self::Value, Error> {
                Ok(PreserveFileTimesPolicy::Bool(value))
            }

            fn visit_map<Map>(self, map: Map) -> Result<Self::Value, Map::Error>
            where
                Map: serde::de::MapAccess<'de>,
            {
                #[derive(Deserialize)]
                struct Options {
                    #[serde(default)]
                    created: bool,
                    #[serde(default)]
                    modified: bool,
                    #[serde(default)]
                    accessed: bool,
                }

                let options =
                    Options::deserialize(serde::de::value::MapAccessDeserializer::new(map))?;
                Ok(PreserveFileTimesPolicy::Detailed {
                    created: options.created,
                    modified: options.modified,
                    accessed: options.accessed,
                })
            }
        }

        deserializer.deserialize_any(PolicyVisitor)
    }
}

impl Default for PreserveFileTimesPolicy {
    fn default() -> Self {
        Self::Bool(false)
    }
}

impl PreserveFileTimesPolicy {
    pub const fn created(&self) -> bool {
        match self {
            Self::Bool(v) => *v,
            Self::Detailed { created, .. } => *created,
        }
    }

    pub const fn modified(&self) -> bool {
        match self {
            Self::Bool(v) => *v,
            Self::Detailed { modified, .. } => *modified,
        }
    }

    pub const fn accessed(&self) -> bool {
        match self {
            Self::Bool(v) => *v,
            Self::Detailed { accessed, .. } => *accessed,
        }
    }

    pub const fn any(&self) -> bool {
        self.created() || self.modified() || self.accessed()
    }
}

const fn is_preserve_file_times_disabled(v: &PreserveFileTimesPolicy) -> bool {
    !v.any()
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutputPolicy {
    #[serde(default)]
    pub container: OutputContainerPolicy,
    #[serde(default)]
    pub directory: OutputDirectoryPolicy,
    #[serde(default)]
    pub filename: OutputFilenamePolicy,
    /// File time preservation options.
    #[serde(default, skip_serializing_if = "is_preserve_file_times_disabled")]
    pub preserve_file_times: PreserveFileTimesPolicy,
}
