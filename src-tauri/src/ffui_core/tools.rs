use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use anyhow::{anyhow, bail, Context, Result};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::ffui_core::settings::ExternalToolSettings;

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
struct ToolDownloadRuntimeState {
    in_progress: bool,
    progress: Option<f32>, // 0-100 when known, otherwise None for indeterminate.
    last_error: Option<String>,
    last_message: Option<String>,
    /// True when we have determined that the auto-downloaded binary for this
    /// tool cannot be executed on the current system (for example 32-bit vs
    /// 64-bit mismatch). In this case we will not attempt to execute it again
    /// in the current session and instead require a manual path.
    download_arch_incompatible: bool,
    /// True when we have seen a PATH-resolved binary fail with an execution
    /// error that strongly suggests an architecture mismatch. When auto-
    /// download is disabled we surface this as a hard error to the caller.
    path_arch_incompatible: bool,
}

static TOOL_DOWNLOAD_STATE: Lazy<Mutex<HashMap<ExternalToolKind, ToolDownloadRuntimeState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Persistent-in-process metadata about the last successful download per tool.
/// This is used by the engine to record version/tag/sourceUrl into
/// settings.json after an auto-download completes.
#[derive(Debug, Clone)]
struct ToolDownloadMetadata {
    url: String,
    version: Option<String>,
    tag: Option<String>,
}

static LAST_TOOL_DOWNLOAD: Lazy<Mutex<HashMap<ExternalToolKind, ToolDownloadMetadata>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn record_last_tool_download(
    kind: ExternalToolKind,
    url: String,
    version: Option<String>,
    tag: Option<String>,
) {
    let mut map = LAST_TOOL_DOWNLOAD
        .lock()
        .expect("LAST_TOOL_DOWNLOAD lock poisoned");
    map.insert(kind, ToolDownloadMetadata { url, version, tag });
}

pub fn last_tool_download_metadata(
    kind: ExternalToolKind,
) -> Option<(String, Option<String>, Option<String>)> {
    let map = LAST_TOOL_DOWNLOAD
        .lock()
        .expect("LAST_TOOL_DOWNLOAD lock poisoned");
    map.get(&kind)
        .map(|m| (m.url.clone(), m.version.clone(), m.tag.clone()))
}

fn with_download_state<F, R>(kind: ExternalToolKind, f: F) -> R
where
    F: FnOnce(&mut ToolDownloadRuntimeState) -> R,
{
    let mut map = TOOL_DOWNLOAD_STATE
        .lock()
        .expect("TOOL_DOWNLOAD_STATE lock poisoned");
    let entry = map.entry(kind).or_default();
    f(entry)
}

fn snapshot_download_state(kind: ExternalToolKind) -> ToolDownloadRuntimeState {
    let map = TOOL_DOWNLOAD_STATE
        .lock()
        .expect("TOOL_DOWNLOAD_STATE lock poisoned");
    map.get(&kind).cloned().unwrap_or_default()
}

fn mark_download_started(kind: ExternalToolKind, message: String) {
    with_download_state(kind, |state| {
        state.in_progress = true;
        state.progress = None;
        state.last_error = None;
        state.last_message = Some(message);
    });
}

fn mark_download_progress(kind: ExternalToolKind, progress: f32) {
    with_download_state(kind, |state| {
        state.in_progress = true;
        // Clamp into [0, 100] and ignore NaN / infinities.
        let p = progress.clamp(0.0, 100.0);
        if p.is_finite() {
            state.progress = Some(p);
        }
    });
}

fn mark_download_finished(kind: ExternalToolKind, message: String) {
    with_download_state(kind, |state| {
        state.in_progress = false;
        state.progress = Some(100.0);
        state.last_error = None;
        state.last_message = Some(message);
    });
}

fn mark_download_error(kind: ExternalToolKind, message: String) {
    with_download_state(kind, |state| {
        state.in_progress = false;
        state.last_error = Some(message);
    });
}

fn mark_arch_incompatible_for_session(
    kind: ExternalToolKind,
    source: &str,
    path: &str,
    err: &std::io::Error,
) {
    let tool = tool_binary_name(kind);
    let os_err = err
        .raw_os_error()
        .map(|code| format!(" (os error {code})"))
        .unwrap_or_default();

    let message = if source == "download" {
        format!(
            "自动下载的 {tool} 无法在当前系统上运行（可能是 32 位/64 位架构不匹配）: {err}{os_err}。\
 请在“软件设置 → 外部工具”中关闭自动下载，并手动指定一份可用的 {tool} 路径。当前路径：{path}"
        )
    } else if source == "path" {
        format!(
            "系统无法运行 PATH 中的 {tool}（可能是 32 位/64 位架构不匹配）: {err}{os_err}。\
 可尝试在“软件设置 → 外部工具”中关闭自动下载，或在“软件设置 → 外部工具”中直接指定一份可用的 {tool} 路径。当前 PATH 解析结果：{path}"
        )
    } else {
        format!(
            "{tool} 无法在当前系统上运行（可能是 32 位/64 位架构不匹配）: {err}{os_err}。当前路径：{path}"
        )
    };

    with_download_state(kind, |state| {
        state.in_progress = false;
        state.progress = None;
        state.last_error = Some(message);
        match source {
            "download" => state.download_arch_incompatible = true,
            "path" => state.path_arch_incompatible = true,
            _ => {}
        }
    });
}

// Ensure helper commands (version checks, probes, etc.) do not pop up visible
// console windows on Windows. On other platforms this is a no-op.
#[cfg(windows)]
fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_background_command(_cmd: &mut Command) {}

fn tool_binary_name(kind: ExternalToolKind) -> &'static str {
    match kind {
        ExternalToolKind::Ffmpeg => "ffmpeg",
        ExternalToolKind::Ffprobe => "ffprobe",
        ExternalToolKind::Avifenc => "avifenc",
    }
}

fn custom_path_for(kind: ExternalToolKind, settings: &ExternalToolSettings) -> Option<String> {
    match kind {
        ExternalToolKind::Ffmpeg => settings.ffmpeg_path.clone(),
        ExternalToolKind::Ffprobe => settings.ffprobe_path.clone(),
        ExternalToolKind::Avifenc => settings.avifenc_path.clone(),
    }
}

pub fn resolve_tool_path(
    kind: ExternalToolKind,
    settings: &ExternalToolSettings,
) -> Result<(String, String)> {
    if let Some(custom) = custom_path_for(kind, settings) {
        return Ok((custom, "custom".to_string()));
    }

    // Prefer a previously auto-downloaded binary next to the executable if it exists.
    if let Some(downloaded) = downloaded_tool_path(kind) {
        return Ok((
            downloaded.to_string_lossy().into_owned(),
            "download".to_string(),
        ));
    }

    let bin = tool_binary_name(kind).to_string();
    // Using bare binary name relies on system PATH; this matches the spec requirement.
    Ok((bin, "path".to_string()))
}

pub fn ensure_tool_available(
    kind: ExternalToolKind,
    settings: &ExternalToolSettings,
) -> Result<(String, String, bool)> {
    let (mut path, mut source) = resolve_tool_path(kind, settings)?;
    let runtime_state = snapshot_download_state(kind);
    let mut did_download = false;

    // If we already know that an auto-downloaded binary is not executable on
    // this system, fail fast and ask the user to provide a manual path.
    if source == "download" && runtime_state.download_arch_incompatible {
        return Err(anyhow!(
            "{} auto-downloaded binary at '{}' cannot be executed on this system; \
请在“软件设置 → 外部工具”中关闭自动下载，并手动指定一份可用的 {} 路径。",
            tool_binary_name(kind),
            path,
            tool_binary_name(kind),
        ));
    }

    // If PATH-based tool has been identified as architecture-incompatible and
    // auto-download is disabled, surface a clear error instead of silently
    // retrying the same broken binary.
    if source == "path" && runtime_state.path_arch_incompatible && !settings.auto_download {
        return Err(anyhow!(
            "system-provided {} at '{}' cannot be executed on this system; \
请在“软件设置 → 外部工具”中关闭自动下载，或在设置中指定一份可用的 {} 路径。",
            tool_binary_name(kind),
            path,
            tool_binary_name(kind),
        ));
    }

    // First probe: many callers hit this fast path when a working tool is
    // already on PATH, at a custom location, or in the tools/ directory.
    let mut verified = verify_tool_binary(&path, kind, &source);

    // Auto-download is only allowed when we are relying on PATH. This avoids
    // fighting with an explicit custom path and prevents re-downloading a
    // broken tools/ binary on every call.
    if settings.auto_download && !verified && source == "path" {
        match download_tool_binary(kind) {
            Ok(downloaded) => {
                path = downloaded.to_string_lossy().into_owned();
                source = "download".to_string();
                did_download = true;
                verified = verify_tool_binary(&path, kind, &source);
            }
            Err(err) => {
                return Err(anyhow!(
                    "{} not found and auto-download failed: {err}",
                    tool_binary_name(kind)
                ));
            }
        }
    }

    // If we still cannot run the tool after an optional auto-download, bail
    // out instead of attempting more downloads on every call.
    if !verified {
        return Err(anyhow!(
            "{} does not appear to be available at '{}'. Install it or configure a valid custom path.",
            tool_binary_name(kind),
            path
        ));
    }

    // Optionally migrate PATH-based tools to the pinned static build. We only
    // ever treat PATH tools as update candidates; once a tool has been
    // auto-downloaded (source == "download") we consider it converged and
    // avoid re-downloading the same version on every call.
    let local_version = detect_local_tool_version(&path, kind);
    let remote_version = if settings.auto_update {
        latest_remote_version(kind)
    } else {
        None
    };
    if should_mark_update_available(
        settings.auto_update,
        &source,
        local_version.as_deref(),
        remote_version.as_deref(),
    ) {
        if let Ok(downloaded) = download_tool_binary(kind) {
            let new_path = downloaded.to_string_lossy().into_owned();
            if verify_tool_binary(&new_path, kind, "download") {
                path = new_path;
                source = "download".to_string();
                did_download = true;
            }
        }
    }

    Ok((path, source, did_download))
}

fn should_mark_update_available(
    auto_update_enabled: bool,
    source: &str,
    local_version: Option<&str>,
    remote_version: Option<&str>,
) -> bool {
    if !auto_update_enabled || source != "path" {
        return false;
    }
    match (local_version, remote_version) {
        (Some(local), Some(remote)) => !local.contains(remote),
        _ => false,
    }
}

pub fn tool_status(kind: ExternalToolKind, settings: &ExternalToolSettings) -> ExternalToolStatus {
    let auto_download_enabled = settings.auto_download;
    let auto_update_enabled = settings.auto_update;

    // For status reporting we prefer a lightweight, best-effort probe:
    // resolve the path and, if possible, grab a version line in a single process
    // spawn. This avoids double-spawning the tool just to confirm availability.
    let (resolved_path, source, version, update_available) = match resolve_tool_path(kind, settings)
    {
        Ok((path, source)) => {
            let version = detect_local_tool_version(&path, kind);
            let remote = if auto_update_enabled {
                latest_remote_version(kind)
            } else {
                None
            };
            let update_available = should_mark_update_available(
                auto_update_enabled,
                &source,
                version.as_deref(),
                remote.as_deref(),
            );
            (Some(path), Some(source), version, update_available)
        }
        Err(_) => (None, None, None, false),
    };

    let runtime = snapshot_download_state(kind);

    ExternalToolStatus {
        kind,
        resolved_path,
        source,
        version,
        update_available,
        auto_download_enabled,
        auto_update_enabled,
        // Map runtime state so the UI can render download-in-progress cards.
        download_in_progress: runtime.in_progress,
        download_progress: runtime.progress,
        last_download_error: runtime.last_error,
        last_download_message: runtime.last_message,
    }
}

fn tools_dir() -> Result<PathBuf> {
    let exe = std::env::current_exe().context("failed to resolve current executable")?;
    let dir = exe
        .parent()
        .map(Path::to_path_buf)
        .context("failed to resolve executable directory")?;
    let tools = dir.join("tools");
    fs::create_dir_all(&tools)
        .with_context(|| format!("failed to create tools directory {}", tools.display()))?;
    Ok(tools)
}

fn downloaded_tool_filename(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn downloaded_tool_path(kind: ExternalToolKind) -> Option<PathBuf> {
    let base = tool_binary_name(kind);
    let filename = downloaded_tool_filename(base);
    let dir = tools_dir().ok()?;
    let candidate = dir.join(filename);
    if candidate.exists() {
        Some(candidate)
    } else {
        None
    }
}

#[cfg(windows)]
fn is_exec_arch_mismatch(err: &std::io::Error) -> bool {
    // ERROR_BAD_EXE_FORMAT. This is the typical signal for trying to run a
    // 32-bit binary on 64-bit Windows or another incompatible PE image.
    matches!(err.raw_os_error(), Some(193))
}

#[cfg(not(windows))]
fn is_exec_arch_mismatch(err: &std::io::Error) -> bool {
    // On Unix-like systems, ENOEXEC (8) is raised when the OS loader cannot
    // execute the file as a program. This often indicates an incompatible or
    // corrupt binary. It is not a perfect architecture check but is a strong
    // signal that this tool will never run successfully.
    matches!(err.raw_os_error(), Some(8))
}

fn verify_tool_binary(path: &str, kind: ExternalToolKind, source: &str) -> bool {
    // Prefer `-version` which works for ffmpeg/ffprobe and avoids the
    // non-zero exit code some builds use for `--version`.
    let mut cmd = Command::new(path);
    configure_background_command(&mut cmd);
    cmd.arg("-version");

    match cmd.output() {
        Ok(out) => out.status.success(),
        Err(err) => {
            if is_exec_arch_mismatch(&err) {
                // Treat this as an architecture incompatibility and remember it
                // for the rest of the session so we do not keep trying to run
                // a broken binary.
                mark_arch_incompatible_for_session(kind, source, path, &err);
            }
            false
        }
    }
}

fn detect_local_tool_version(path: &str, _kind: ExternalToolKind) -> Option<String> {
    let mut cmd = Command::new(path);
    configure_background_command(&mut cmd);
    cmd.arg("-version")
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
}

/// Pinned upstream ffmpeg version used as a fallback when GitHub metadata is
/// unavailable. Upstream 仓库使用 tag `b6.0` 对应 ffmpeg 6.0，这里把用户可见的
/// “版本号”和下载用的 tag 解耦，减少与 `ffmpeg -version` 输出的混淆。
const FFMPEG_STATIC_VERSION: &str = "6.0";
const FFMPEG_STATIC_TAG: &str = "b6.0";

#[derive(Debug, Clone)]
struct FfmpegStaticRelease {
    version: String,
    tag: String,
}

static FFMPEG_RELEASE_CACHE: Lazy<Mutex<Option<FfmpegStaticRelease>>> =
    Lazy::new(|| Mutex::new(None));

fn semantic_version_from_tag(tag: &str) -> String {
    let idx = tag.find(|c: char| c.is_ascii_digit()).unwrap_or(0);
    tag[idx..].to_string()
}

fn current_ffmpeg_release() -> FfmpegStaticRelease {
    {
        let cache = FFMPEG_RELEASE_CACHE
            .lock()
            .expect("FFMPEG_RELEASE_CACHE lock poisoned");
        if let Some(info) = cache.as_ref() {
            return info.clone();
        }
    }

    let from_github = fetch_ffmpeg_release_from_github();
    let info = match from_github {
        Some(tag) => {
            let version = semantic_version_from_tag(&tag);
            FfmpegStaticRelease { version, tag }
        }
        None => FfmpegStaticRelease {
            version: FFMPEG_STATIC_VERSION.to_string(),
            tag: FFMPEG_STATIC_TAG.to_string(),
        },
    };

    let mut cache = FFMPEG_RELEASE_CACHE
        .lock()
        .expect("FFMPEG_RELEASE_CACHE lock poisoned");
    *cache = Some(info.clone());
    info
}

#[cfg(not(test))]
fn fetch_ffmpeg_release_from_github() -> Option<String> {
    use reqwest::blocking::Client;
    use reqwest::Proxy;
    use std::time::Duration;

    let mut builder = Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("ffui/ffmpeg-static-updater");

    if let Some(proxy_url) = proxy_from_env() {
        if let Ok(proxy) = Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
        }
    }

    let client = builder.build().ok()?;
    let resp = client
        .get("https://api.github.com/repos/eugeneware/ffmpeg-static/releases/latest")
        .send()
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    #[derive(Deserialize)]
    struct Release {
        tag_name: String,
    }

    let release: Release = resp.json().ok()?;
    Some(release.tag_name)
}

#[cfg(test)]
fn fetch_ffmpeg_release_from_github() -> Option<String> {
    None
}

fn latest_remote_version(kind: ExternalToolKind) -> Option<String> {
    match kind {
        ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe => {
            Some(current_ffmpeg_release().version)
        }
        ExternalToolKind::Avifenc => None,
    }
}

fn default_ffmpeg_download_url() -> Result<String> {
    let release = current_ffmpeg_release();
    let tag = release.tag;

    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffmpeg-win32-x64"
        ))
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffmpeg-linux-x64"
        ))
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffmpeg-linux-arm64"
        ))
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffmpeg-darwin-x64"
        ))
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffmpeg-darwin-arm64"
        ))
    } else {
        Err(anyhow!(
            "auto-download for ffmpeg-static is not supported on this platform"
        ))
    }
}

fn default_ffprobe_download_url() -> Result<String> {
    let release = current_ffmpeg_release();
    let tag = release.tag;

    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffprobe-win32-x64"
        ))
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffprobe-linux-x64"
        ))
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffprobe-linux-arm64"
        ))
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffprobe-darwin-x64"
        ))
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffprobe-darwin-arm64"
        ))
    } else {
        Err(anyhow!(
            "auto-download for ffprobe-static is not supported on this platform"
        ))
    }
}

/// Fixed libavif version for avifenc/avifdec CLI tools.
const LIBAVIF_VERSION: &str = "v1.3.0";

fn default_avifenc_zip_url() -> Result<&'static str> {
    // libavif publishes per-platform "artifacts" archives that contain the
    // avifenc CLI. We currently support a single zip per OS and select the
    // right one based on target_os. The archive layout is probed at runtime
    // when extracting avifenc.
    if cfg!(target_os = "windows") {
        Ok("https://github.com/AOMediaCodec/libavif/releases/download/v1.3.0/windows-artifacts.zip")
    } else if cfg!(target_os = "linux") {
        Ok("https://github.com/AOMediaCodec/libavif/releases/download/v1.3.0/linux-artifacts.zip")
    } else if cfg!(target_os = "macos") {
        Ok("https://github.com/AOMediaCodec/libavif/releases/download/v1.3.0/macOS-artifacts.zip")
    } else {
        Err(anyhow!(
            "auto-download for avifenc is not supported on this platform"
        ))
    }
}

fn aria2c_available() -> bool {
    // Best-effort check: if we can spawn `aria2c --version` and it exits,
    // consider it available. Errors and missing binaries are treated as false.
    let mut cmd = Command::new("aria2c");
    configure_background_command(&mut cmd);
    cmd.arg("--version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn download_file_with_aria2c(url: &str, dest: &Path) -> Result<()> {
    let dir = dest
        .parent()
        .ok_or_else(|| anyhow!("destination {} has no parent directory", dest.display()))?;
    fs::create_dir_all(dir).with_context(|| format!("failed to create {}", dir.display()))?;

    let filename = dest
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("destination {} has invalid file name", dest.display()))?;

    let mut cmd = Command::new("aria2c");
    configure_background_command(&mut cmd);
    let status = cmd
        .arg("--allow-overwrite=true")
        .arg("--auto-file-renaming=false")
        .arg("--dir")
        .arg(dir)
        .arg("--out")
        .arg(filename)
        .arg(url)
        .status()
        .with_context(|| format!("failed to spawn aria2c to download {url}"))?;

    if !status.success() {
        bail!("aria2c exited with status {status} while downloading {url}");
    }

    Ok(())
}

fn proxy_from_env() -> Option<String> {
    for key in &["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(v) = std::env::var(key) {
            if !v.trim().is_empty() {
                return Some(v);
            }
        }
    }
    None
}

fn download_file_with_reqwest<F>(url: &str, dest: &Path, mut on_progress: F) -> Result<()>
where
    F: FnMut(u64, Option<u64>),
{
    use reqwest::blocking::Client;
    use reqwest::Proxy;
    use std::time::Duration;

    let dir = dest
        .parent()
        .ok_or_else(|| anyhow!("destination {} has no parent directory", dest.display()))?;
    fs::create_dir_all(dir).with_context(|| format!("failed to create {}", dir.display()))?;

    let mut builder = Client::builder().timeout(Duration::from_secs(30));

    if let Some(proxy_url) = proxy_from_env() {
        if let Ok(proxy) = Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
        }
    }

    let client = builder
        .build()
        .context("failed to build HTTP client for ffmpeg-static download")?;

    let mut resp = client.get(url).send().with_context(|| {
        format!(
            "failed to download {} from {}",
            tool_binary_name(ExternalToolKind::Ffmpeg),
            url
        )
    })?;

    if !resp.status().is_success() {
        bail!(
            "download of {} from {} failed with status {}",
            tool_binary_name(ExternalToolKind::Ffmpeg),
            url,
            resp.status()
        );
    }

    let mut file =
        fs::File::create(dest).with_context(|| format!("failed to create {}", dest.display()))?;

    let total_len = resp.content_length();
    let mut downloaded: u64 = 0;
    let mut buf = [0u8; 8192];

    loop {
        let n = resp
            .read(&mut buf)
            .context("failed to read downloaded bytes")?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .with_context(|| format!("failed to write {}", dest.display()))?;
        downloaded += n as u64;
        on_progress(downloaded, total_len);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(dest)
            .with_context(|| format!("failed to read metadata for {}", dest.display()))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(dest, perms)
            .with_context(|| format!("failed to mark {} as executable", dest.display()))?;
    }

    Ok(())
}

fn download_bytes_with_reqwest<F>(url: &str, mut on_progress: F) -> Result<Vec<u8>>
where
    F: FnMut(u64, Option<u64>),
{
    use reqwest::blocking::Client;
    use reqwest::Proxy;
    use std::time::Duration;

    let mut builder = Client::builder().timeout(Duration::from_secs(30));

    if let Some(proxy_url) = proxy_from_env() {
        if let Ok(proxy) = Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
        }
    }

    let client = builder
        .build()
        .context("failed to build HTTP client for avifenc download")?;

    let mut resp = client
        .get(url)
        .send()
        .with_context(|| format!("failed to download avifenc from {url}"))?;

    if !resp.status().is_success() {
        bail!(
            "download of avifenc from {} failed with status {}",
            url,
            resp.status()
        );
    }

    let total_len = resp.content_length();
    let mut downloaded: u64 = 0;
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];

    loop {
        let n = resp
            .read(&mut buf)
            .context("failed to read downloaded avifenc bytes")?;
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        downloaded += n as u64;
        on_progress(downloaded, total_len);
    }

    Ok(out)
}

fn extract_avifenc_from_zip(data: &[u8], dest: &Path) -> Result<()> {
    let reader = Cursor::new(data);
    let mut archive =
        zip::ZipArchive::new(reader).context("failed to open downloaded avifenc zip archive")?;

    let mut found_index: Option<usize> = None;

    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .with_context(|| format!("failed to read zip entry at index {i}"))?;
        if file.is_dir() {
            continue;
        }
        let name = file.name().to_string();

        #[cfg(windows)]
        let is_avifenc = name.to_ascii_lowercase().ends_with("avifenc.exe");

        #[cfg(not(windows))]
        let is_avifenc = {
            let lower = name.to_ascii_lowercase();
            // Guard against DLLs or other artifacts; only match the actual
            // avifenc binary by requiring it to be the last path segment.
            if !lower.ends_with("avifenc") {
                false
            } else {
                lower
                    .rsplit('/')
                    .next()
                    .map(|seg| seg == "avifenc")
                    .unwrap_or(false)
            }
        };

        if is_avifenc {
            found_index = Some(i);
            break;
        }
    }

    let idx = found_index
        .ok_or_else(|| anyhow!("could not find avifenc inside downloaded libavif artifacts"))?;

    let mut file = archive
        .by_index(idx)
        .with_context(|| format!("failed to open avifenc zip entry {idx} for extraction"))?;

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }

    {
        let mut out = fs::File::create(dest)
            .with_context(|| format!("failed to create {}", dest.display()))?;
        std::io::copy(&mut file, &mut out)
            .with_context(|| format!("failed to extract {}", dest.display()))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(dest)
            .with_context(|| format!("failed to read metadata for {}", dest.display()))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(dest, perms)
            .with_context(|| format!("failed to mark {} as executable", dest.display()))?;
    }

    Ok(())
}

fn download_tool_binary(kind: ExternalToolKind) -> Result<PathBuf> {
    // Track runtime download state so the settings UI can surface activity.
    mark_download_started(
        kind,
        format!("starting auto-download for {}", tool_binary_name(kind)),
    );

    let result = match kind {
        ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe => {
            let url = match kind {
                ExternalToolKind::Ffmpeg => default_ffmpeg_download_url()?,
                ExternalToolKind::Ffprobe => default_ffprobe_download_url()?,
                _ => unreachable!(),
            };

            // Remember which version/tag/URL we are downloading so the engine
            // can persist this into settings.json after a successful download.
            let release = current_ffmpeg_release();
            record_last_tool_download(kind, url.clone(), Some(release.version), Some(release.tag));

            let dir = tools_dir()?;
            let filename = downloaded_tool_filename(tool_binary_name(kind));
            let dest_path = dir.join(&filename);

            if aria2c_available() {
                if let Err(err) = download_file_with_aria2c(&url, &dest_path) {
                    eprintln!(
                        "aria2c download failed for {filename} ({url}): {err:#}; falling back to built-in HTTP client"
                    );
                    download_file_with_reqwest(&url, &dest_path, |downloaded, total| {
                        if let Some(total) = total {
                            let pct = (downloaded as f32 / total as f32) * 100.0;
                            mark_download_progress(kind, pct);
                        }
                    })?;
                }
            } else {
                download_file_with_reqwest(&url, &dest_path, |downloaded, total| {
                    if let Some(total) = total {
                        let pct = (downloaded as f32 / total as f32) * 100.0;
                        mark_download_progress(kind, pct);
                    }
                })?;
            }

            Ok(dest_path)
        }
        ExternalToolKind::Avifenc => {
            let url = default_avifenc_zip_url()?;
            let bytes = download_bytes_with_reqwest(url, |downloaded, total| {
                if let Some(total) = total {
                    let pct = (downloaded as f32 / total as f32) * 100.0;
                    mark_download_progress(kind, pct);
                }
            })?;

            let dir = tools_dir()?;
            let filename = downloaded_tool_filename(tool_binary_name(kind));
            let dest_path = dir.join(&filename);

            extract_avifenc_from_zip(&bytes, &dest_path)?;
            // Record avifenc download metadata as well so we can avoid
            // repeated downloads and surface the libavif version if needed.
            record_last_tool_download(
                kind,
                url.to_string(),
                Some(LIBAVIF_VERSION.to_string()),
                Some(LIBAVIF_VERSION.to_string()),
            );
            Ok(dest_path)
        }
    };

    match result {
        Ok(path) => {
            mark_download_finished(
                kind,
                format!(
                    "auto-download completed for {} (path: {})",
                    tool_binary_name(kind),
                    path.display()
                ),
            );
            Ok(path)
        }
        Err(err) => {
            mark_download_error(
                kind,
                format!(
                    "auto-download for {} failed: {err:#}",
                    tool_binary_name(kind)
                ),
            );
            Err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs::{self, File};
    use std::io::Write;

    #[test]
    fn verify_tool_binary_handles_tools_that_fail_on_long_version_flag() {
        let dir = env::temp_dir();

        #[cfg(windows)]
        {
            let path = dir.join("fake_ffmpeg.bat");
            let mut file = File::create(&path).expect("create fake ffmpeg .bat");
            writeln!(file, "@echo off").unwrap();
            writeln!(file, "if \"%1\"==\"--version\" exit /b 8").unwrap();
            writeln!(file, "if \"%1\"==\"-version\" exit /b 0").unwrap();
            writeln!(file, "exit /b 1").unwrap();

            assert!(verify_tool_binary(
                path.to_string_lossy().as_ref(),
                ExternalToolKind::Ffmpeg,
                "path"
            ));
            let _ = fs::remove_file(&path);
        }

        #[cfg(not(windows))]
        {
            let path = dir.join("fake_ffmpeg.sh");
            let mut file = File::create(&path).expect("create fake ffmpeg script");
            writeln!(file, "#!/usr/bin/env sh").unwrap();
            writeln!(file, "if [ \"$1\" = \"--version\" ]; then exit 8; fi").unwrap();
            writeln!(file, "if [ \"$1\" = \"-version\" ]; then exit 0; fi").unwrap();
            writeln!(file, "exit 1").unwrap();

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = fs::metadata(&path)
                    .expect("read permissions for fake ffmpeg script")
                    .permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&path, perms).expect("mark fake ffmpeg script as executable");
            }

            assert!(verify_tool_binary(
                path.to_string_lossy().as_ref(),
                ExternalToolKind::Ffmpeg,
                "path"
            ));
            let _ = fs::remove_file(&path);
        }
    }

    #[test]
    fn should_mark_update_available_only_for_path_source() {
        // PATH-based tool with mismatched version string should be considered
        // updatable when auto-update is enabled.
        let local = Some("ffmpeg version 4.0.0");
        let remote = Some(FFMPEG_STATIC_VERSION);
        assert!(
            should_mark_update_available(true, "path", local, remote),
            "path-based tool should be considered updatable when local version does not contain the pinned tag"
        );

        // Auto-update disabled: never mark updates as available.
        assert!(
            !should_mark_update_available(false, "path", local, remote),
            "auto-update disabled must suppress update_available even for PATH tools"
        );

        // Custom and download sources are always treated as user-managed and
        // must not be marked as having updates available.
        assert!(
            !should_mark_update_available(true, "custom", local, remote),
            "custom-path tools should not be marked as updatable by the auto-update logic"
        );
        assert!(
            !should_mark_update_available(true, "download", local, remote),
            "auto-downloaded tools should not be marked as updatable for the same pinned tag"
        );

        // Missing version information should not produce false positives.
        assert!(
            !should_mark_update_available(true, "path", None, remote),
            "missing local version must not be treated as needing an update"
        );
        assert!(
            !should_mark_update_available(true, "path", local, None),
            "missing remote version must not be treated as needing an update"
        );
    }

    #[test]
    fn semantic_version_from_tag_strips_non_numeric_prefix() {
        assert_eq!(semantic_version_from_tag("b6.0"), "6.0");
        assert_eq!(semantic_version_from_tag("v5.1.2"), "5.1.2");
        assert_eq!(semantic_version_from_tag("7.0"), "7.0");
        // If there is no digit at all, we currently return the whole tag.
        assert_eq!(semantic_version_from_tag("nightly"), "nightly");
    }

    #[test]
    fn tool_status_exposes_download_state_defaults() {
        // Start from a clean runtime state so earlier tests that touched the
        // global download map do not leak into this assertion.
        {
            let mut map = TOOL_DOWNLOAD_STATE
                .lock()
                .expect("TOOL_DOWNLOAD_STATE lock poisoned");
            map.clear();
        }

        // When no download has been triggered, the runtime fields should be
        // well-formed and defaulted so the frontend can rely on them without
        // extra null checks.
        let settings = crate::ffui_core::settings::ExternalToolSettings {
            ffmpeg_path: None,
            ffprobe_path: None,
            avifenc_path: None,
            auto_download: false,
            auto_update: false,
            downloaded: None,
        };

        let status = tool_status(ExternalToolKind::Ffmpeg, &settings);
        assert!(!status.download_in_progress);
        assert!(status.download_progress.is_none() || status.download_progress == Some(0.0));
        assert!(status.last_download_error.is_none());
        assert!(status.last_download_message.is_none());
    }
}
