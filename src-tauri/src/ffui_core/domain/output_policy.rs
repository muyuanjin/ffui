use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum OutputContainerPolicy {
    /// Follow the preset (structured) or the advanced template when present.
    #[serde(rename = "default")]
    Default,
    /// Force the output container to match the input file's extension.
    #[serde(rename = "keepInput")]
    KeepInput,
    /// Force the output container to an explicit format (e.g. mkv/mp4).
    #[serde(rename = "force")]
    Force { format: String },
}

impl Default for OutputContainerPolicy {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum OutputDirectoryPolicy {
    #[serde(rename = "sameAsInput")]
    SameAsInput,
    #[serde(rename = "fixed")]
    Fixed { directory: String },
}

impl Default for OutputDirectoryPolicy {
    fn default() -> Self {
        Self::SameAsInput
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutputFilenameRegexReplace {
    pub pattern: String,
    pub replacement: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum OutputFilenameAppend {
    /// The literal suffix string in `OutputFilenamePolicy::suffix`.
    Suffix,
    Timestamp,
    EncoderQuality,
    Random,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

fn is_false(v: &bool) -> bool {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

impl Default for PreserveFileTimesPolicy {
    fn default() -> Self {
        Self::Bool(false)
    }
}

impl PreserveFileTimesPolicy {
    pub fn created(&self) -> bool {
        match self {
            Self::Bool(v) => *v,
            Self::Detailed { created, .. } => *created,
        }
    }

    pub fn modified(&self) -> bool {
        match self {
            Self::Bool(v) => *v,
            Self::Detailed { modified, .. } => *modified,
        }
    }

    pub fn accessed(&self) -> bool {
        match self {
            Self::Bool(v) => *v,
            Self::Detailed { accessed, .. } => *accessed,
        }
    }

    pub fn any(&self) -> bool {
        self.created() || self.modified() || self.accessed()
    }
}

fn is_preserve_file_times_disabled(v: &PreserveFileTimesPolicy) -> bool {
    !v.any()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
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
