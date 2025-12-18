use serde::{
    Deserialize,
    Serialize,
};

/// Stable file fingerprint for an external tool binary.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct ExternalToolBinaryFingerprint {
    pub len: u64,
    /// Unix epoch timestamp in milliseconds from filesystem metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_millis: Option<u64>,
}

/// Persisted probe result for an external tool binary path.
///
/// This is used to seed the in-process probe cache on startup so that
/// unchanged tool binaries do not need to be spawned on every launch.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct ExternalToolProbeCacheEntry {
    pub path: String,
    pub fingerprint: ExternalToolBinaryFingerprint,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at_ms: Option<u64>,
}

/// Per-tool persisted probe cache (bounded, best-effort).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct ExternalToolProbeCache {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ffmpeg: Option<ExternalToolProbeCacheEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ffprobe: Option<ExternalToolProbeCacheEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avifenc: Option<ExternalToolProbeCacheEntry>,
}
