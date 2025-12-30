use serde::{Deserialize, Serialize};

use super::ExternalToolProbeCache;

/// Human-readable metadata for a downloaded tool binary.
/// All fields are optional so existing settings.json files remain valid and minimal.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DownloadedToolInfo {
    /// Human-readable version string for the downloaded tool, e.g. "6.0".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Optional tag or build identifier, e.g. "b6.0" for ffmpeg-static.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// Source URL used to download this binary.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    /// Unix epoch timestamp in milliseconds when the download completed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded_at: Option<u64>,
}

/// Per-tool metadata for auto-downloaded binaries. All fields are optional so
/// existing settings.json files remain valid and minimal.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DownloadedToolState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ffmpeg: Option<DownloadedToolInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ffprobe: Option<DownloadedToolInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avifenc: Option<DownloadedToolInfo>,
}

/// Cached remote tool version metadata (for update hints) persisted across restarts.
///
/// All fields are optional so existing settings.json files remain valid and minimal.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RemoteToolVersionInfo {
    /// Unix epoch timestamp in milliseconds when the remote check completed successfully.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at_ms: Option<u64>,
    /// Latest known remote version string, e.g. "6.1.1".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Optional upstream tag/build identifier, e.g. "b6.1.1".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

/// Remote version caches for tools that support remote update hints.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RemoteToolVersionCache {
    /// Cached remote release metadata for the ffmpeg-static upstream used by ffmpeg/ffprobe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ffmpeg_static: Option<RemoteToolVersionInfo>,
    /// Cached remote release metadata for libavif upstream used by avifenc.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub libavif: Option<RemoteToolVersionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ExternalToolSettings {
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub avifenc_path: Option<String>,
    pub auto_download: bool,
    pub auto_update: bool,
    /// Optional metadata about binaries that were auto-downloaded by the app.
    /// When absent, the app infers availability only from the filesystem.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded: Option<DownloadedToolState>,
    /// Optional cached remote-version metadata (TTL-based) for update hints.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_version_cache: Option<RemoteToolVersionCache>,
    /// Optional persisted probe cache used to avoid spawning tools on every startup.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe_cache: Option<ExternalToolProbeCache>,
}
