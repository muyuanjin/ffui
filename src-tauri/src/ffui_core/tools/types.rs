use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ExternalToolKind {
    Ffmpeg,
    Ffprobe,
    Avifenc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalToolStatus {
    pub kind: ExternalToolKind,
    pub resolved_path: Option<String>,
    pub source: Option<String>,
    pub version: Option<String>,
    pub update_available: bool,
    pub auto_download_enabled: bool,
    pub auto_update_enabled: bool,
    /// True when an auto-download for this tool is currently running.
    pub download_in_progress: bool,
    /// Optional percentage (0-100) for the current download; None means
    /// progress is indeterminate and the UI should show a spinner instead.
    pub download_progress: Option<f32>,
    /// Last error message observed while trying to download/update this tool.
    pub last_download_error: Option<String>,
    /// Last informational message about download/update activity.
    pub last_download_message: Option<String>,
}

/// In-memory runtime download state for each external tool. This is used to
/// enrich `ExternalToolStatus` so the frontend can render progress bars and
/// error messages while ffmpeg/ffprobe/avifenc are being auto-downloaded.
#[derive(Debug, Clone, Default)]
pub(super) struct ToolDownloadRuntimeState {
    pub(super) in_progress: bool,
    pub(super) progress: Option<f32>, // 0-100 when known, otherwise None for indeterminate.
    pub(super) last_error: Option<String>,
    pub(super) last_message: Option<String>,
    /// True when we have determined that the auto-downloaded binary for this
    /// tool cannot be executed on the current system (for example 32-bit vs
    /// 64-bit mismatch). In this case we will not attempt to execute it again
    /// in the current session and instead require a manual path.
    pub(super) download_arch_incompatible: bool,
    /// True when we have seen a PATH-resolved binary fail with an execution
    /// error that strongly suggests an architecture mismatch. When auto-
    /// download is disabled we surface this as a hard error to the caller.
    pub(super) path_arch_incompatible: bool,
}

pub(super) static TOOL_DOWNLOAD_STATE: Lazy<
    Mutex<HashMap<ExternalToolKind, ToolDownloadRuntimeState>>,
> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Persistent-in-process metadata about the last successful download per tool.
/// This is used by the engine to record version/tag/sourceUrl into
/// settings.json after an auto-download completes.
#[derive(Debug, Clone)]
pub(super) struct ToolDownloadMetadata {
    pub(super) url: String,
    pub(super) version: Option<String>,
    pub(super) tag: Option<String>,
}

pub(super) static LAST_TOOL_DOWNLOAD: Lazy<Mutex<HashMap<ExternalToolKind, ToolDownloadMetadata>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Pinned upstream ffmpeg version used as a fallback when GitHub metadata is
/// unavailable. Upstream 仓库使用 tag `b6.0` 对应 ffmpeg 6.0，这里把用户可见的
/// "版本号"和下载用的 tag 解耦，减少与 `ffmpeg -version` 输出的混淆。
pub(super) const FFMPEG_STATIC_VERSION: &str = "6.0";
pub(super) const FFMPEG_STATIC_TAG: &str = "b6.0";

#[derive(Debug, Clone)]
pub(super) struct FfmpegStaticRelease {
    pub(super) version: String,
    pub(super) tag: String,
}

pub(super) static FFMPEG_RELEASE_CACHE: Lazy<Mutex<Option<FfmpegStaticRelease>>> =
    Lazy::new(|| Mutex::new(None));

/// Fixed libavif version for avifenc/avifdec CLI tools.
pub(super) const LIBAVIF_VERSION: &str = "v1.3.0";
