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
}

fn is_false(v: &bool) -> bool {
    !*v
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
        }
    }
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
    /// When true, try to preserve creation/modified/access times from input.
    #[serde(default, skip_serializing_if = "is_false")]
    pub preserve_file_times: bool,
}
