use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSourceFontInfo {
    pub id: String,
    pub name: String,
    pub family_name: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFontFamily {
    pub primary: String,
    pub names: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFontInfo {
    pub id: String,
    pub family_name: String,
    pub path: String,
    pub format: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UiFontDownloadStatus {
    Starting,
    Downloading,
    Ready,
    Error,
    Canceled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiFontDownloadSnapshot {
    pub session_id: u64,
    pub font_id: String,
    pub status: UiFontDownloadStatus,
    pub received_bytes: u64,
    pub total_bytes: Option<u64>,
    pub family_name: String,
    pub format: String,
    pub path: Option<String>,
    pub error: Option<String>,
}
