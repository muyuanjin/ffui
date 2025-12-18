use serde::{
    Deserialize,
    Serialize,
};

fn is_true(value: &bool) -> bool {
    *value
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeActivityDay {
    pub date: String,
    pub active_hours_mask: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MonitorSettings {
    /// Bounded recent activity days for the transcode heatmap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcode_activity_days: Option<Vec<TranscodeActivityDay>>,
}

/// Persisted updater preferences and cached metadata.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AppUpdaterSettings {
    /// When true (default), check for updates on startup (TTL-based).
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub auto_check: bool,
    /// Unix epoch timestamp in milliseconds when the last update check completed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checked_at_ms: Option<u64>,
    /// Latest known available version when the last check found an update.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_version: Option<String>,
}
