use super::types::*;

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
        state.last_error = None;
        state.last_message = Some(message);
    });
}

pub(super) fn mark_download_progress(kind: ExternalToolKind, progress: f32) {
    with_download_state(kind, |state| {
        state.in_progress = true;
        // Clamp into [0, 100] and ignore NaN / infinities.
        let p = progress.clamp(0.0, 100.0);
        if p.is_finite() {
            state.progress = Some(p);
        }
    });
}

pub(super) fn mark_download_finished(kind: ExternalToolKind, message: String) {
    with_download_state(kind, |state| {
        state.in_progress = false;
        state.progress = Some(100.0);
        state.last_error = None;
        state.last_message = Some(message);
    });
}

pub(super) fn mark_download_error(kind: ExternalToolKind, message: String) {
    with_download_state(kind, |state| {
        state.in_progress = false;
        state.last_error = Some(message);
    });
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
 请在\"软件设置 → 外部工具\"中关闭自动下载，并手动指定一份可用的 {tool} 路径。当前路径：{path}"
        )
    } else if source == "path" {
        format!(
            "系统无法运行 PATH 中的 {tool}（可能是 32 位/64 位架构不匹配）: {err}{os_err}。\
 可尝试在\"软件设置 → 外部工具\"中关闭自动下载，或在\"软件设置 → 外部工具\"中直接指定一份可用的 {tool} 路径。当前 PATH 解析结果：{path}"
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
