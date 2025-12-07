use std::sync::{Arc, Mutex};
use std::time::Instant;

use super::types::*;
use tauri::Emitter;

/// Name of the Tauri event used to push external tool status snapshots to the
/// frontend. The payload is a full Vec<ExternalToolStatus>.
pub const TOOL_STATUS_EVENT_NAME: &str = "ffui://external-tool-status";

/// Global app handle used for emitting tool-status events. This is set once
/// during Tauri setup and then read by the download state helpers.
static APP_HANDLE: once_cell::sync::OnceCell<Arc<tauri::AppHandle>> =
    once_cell::sync::OnceCell::new();

/// Cached latest per-tool status snapshot used when emitting events. We keep
/// this in a separate mutex so we don't need to re-probe the filesystem on
/// every progress callback; instead callers provide the freshly computed
/// ExternalToolStatus list.
static LATEST_TOOL_STATUS: once_cell::sync::Lazy<Mutex<Vec<super::types::ExternalToolStatus>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(Vec::new()));

pub(crate) fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(Arc::new(handle));
}

pub(crate) fn update_latest_status_snapshot(statuses: Vec<super::types::ExternalToolStatus>) {
    let mut lock = LATEST_TOOL_STATUS
        .lock()
        .expect("LATEST_TOOL_STATUS lock poisoned");
    *lock = statuses;
}

fn emit_tool_status_event_if_possible() {
    if let Some(handle) = APP_HANDLE.get() {
        let snapshot = {
            let lock = LATEST_TOOL_STATUS
                .lock()
                .expect("LATEST_TOOL_STATUS lock poisoned");
            lock.clone()
        };
        if snapshot.is_empty() {
            return;
        }
        if let Err(err) = handle.emit(TOOL_STATUS_EVENT_NAME, snapshot) {
            eprintln!("failed to emit external tool status event: {err}");
        }
    }
}

pub(super) fn with_download_state<F, R>(kind: ExternalToolKind, f: F) -> R
where
    F: FnOnce(&mut ToolDownloadRuntimeState) -> R,
{
    let mut map = TOOL_DOWNLOAD_STATE
        .lock()
        .expect("TOOL_DOWNLOAD_STATE lock poisoned");
    let entry = map.entry(kind).or_default();
    f(entry)
}

pub(super) fn snapshot_download_state(kind: ExternalToolKind) -> ToolDownloadRuntimeState {
    let map = TOOL_DOWNLOAD_STATE
        .lock()
        .expect("TOOL_DOWNLOAD_STATE lock poisoned");
    map.get(&kind).cloned().unwrap_or_default()
}

pub(super) fn mark_download_started(kind: ExternalToolKind, message: String) {
    with_download_state(kind, |state| {
        state.in_progress = true;
        state.progress = None;
        state.downloaded_bytes = Some(0);
        state.total_bytes = None;
        state.bytes_per_second = None;
        state.started_at = Some(Instant::now());
        state.last_error = None;
        state.last_message = Some(message);
    });

    // When a download starts, push a fresh status snapshot to the frontend so
    // the Settings panel can immediately reflect the new state.
    emit_tool_status_event_if_possible();
}

pub(super) fn mark_download_progress(kind: ExternalToolKind, downloaded: u64, total: Option<u64>) {
    with_download_state(kind, |state| {
        state.in_progress = true;
        let now = Instant::now();

        if state.started_at.is_none() {
            state.started_at = Some(now);
        }

        state.downloaded_bytes = Some(downloaded);
        state.total_bytes = total;

        // Compute a 0–100 percentage when the total size is known.
        let pct = match total {
            Some(total) if total > 0 => (downloaded as f32 / total as f32) * 100.0,
            _ => 0.0,
        };

        // Clamp into [0, 100] and ignore NaN / infinities.
        let p = pct.clamp(0.0, 100.0);
        if p.is_finite() {
            state.progress = Some(p);
        }

        // Compute a simple average download speed since the first byte was
        // observed. This is good enough for一个人类可读的状态指示。
        if let Some(started_at) = state.started_at {
            let elapsed = now.duration_since(started_at).as_secs_f32();
            if elapsed > 0.0 {
                state.bytes_per_second = Some(downloaded as f32 / elapsed);
            } else {
                state.bytes_per_second = None;
            }
        }
    });

    // Push an incremental update so the frontend sees smooth progress/速度。
    emit_tool_status_event_if_possible();
}

pub(super) fn mark_download_finished(kind: ExternalToolKind, message: String) {
    with_download_state(kind, |state| {
        state.in_progress = false;
        state.progress = Some(100.0);
        // 保留最终的字节统计与速度信息，方便前端在短时间内展示“已完成 100%”状态。
        state.last_error = None;
        state.last_message = Some(message);
    });

    // Final event so the UI can flip from “下载中”到“已完成 100%”。
    emit_tool_status_event_if_possible();
}

pub(super) fn mark_download_error(kind: ExternalToolKind, message: String) {
    with_download_state(kind, |state| {
        state.in_progress = false;
        state.last_error = Some(message);
    });

    // Surface错误给前端，以便在设置页显示失败信息。
    emit_tool_status_event_if_possible();
}

pub(super) fn mark_arch_incompatible_for_session(
    kind: ExternalToolKind,
    source: &str,
    path: &str,
    err: &std::io::Error,
) {
    use super::resolve::tool_binary_name;

    let tool = tool_binary_name(kind);
    let os_err = err
        .raw_os_error()
        .map(|code| format!(" (os error {code})"))
        .unwrap_or_default();

    let message = if source == "download" {
        format!(
            "自动下载的 {tool} 无法在当前系统上运行（可能是 32 位/64 位架构不匹配）: {err}{os_err}。\
 请在\"软件设置 → 外部工具\"中手动指定一份可用的 {tool} 路径。当前路径：{path}"
        )
    } else if source == "path" {
        format!(
            "系统无法运行 PATH 中的 {tool}（可能是 32 位/64 位架构不匹配）: {err}{os_err}。\
 请在\"软件设置 → 外部工具\"中直接指定一份可用的 {tool} 路径。当前 PATH 解析结果：{path}"
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

pub(super) fn record_last_tool_download(
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
