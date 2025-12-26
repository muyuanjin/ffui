use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::Emitter;

use super::types::{
    ExternalToolKind, FFMPEG_RELEASE_CACHE, FfmpegStaticRelease, LAST_TOOL_DOWNLOAD,
    LIBAVIF_RELEASE_CACHE, LibavifRelease, TOOL_DOWNLOAD_STATE, ToolDownloadMetadata,
    ToolDownloadRuntimeState,
};
use crate::ffui_core::settings::ExternalToolSettings;
use crate::sync_ext::MutexExt;

/// Name of the Tauri event used to push external tool status snapshots to the
/// frontend. The payload is a full `Vec<ExternalToolStatus>`.
pub const TOOL_STATUS_EVENT_NAME: &str = "ffui://external-tool-status";

/// Global app handle used for emitting tool-status events. This is set once
/// during Tauri setup and then read by the download state helpers.
static APP_HANDLE: once_cell::sync::OnceCell<Arc<tauri::AppHandle>> =
    once_cell::sync::OnceCell::new();

/// Cached latest per-tool status snapshot used when emitting events. We keep
/// this in a separate mutex so we don't need to re-probe the filesystem on
/// every progress callback; instead callers provide the freshly computed
/// `ExternalToolStatus` list.
pub(super) static LATEST_TOOL_STATUS: once_cell::sync::Lazy<
    Mutex<Vec<super::types::ExternalToolStatus>>,
> = once_cell::sync::Lazy::new(|| Mutex::new(Vec::new()));

static TOOL_STATUS_REFRESH_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

pub(crate) fn set_app_handle(handle: tauri::AppHandle) {
    drop(APP_HANDLE.set(Arc::new(handle)));
}

pub(crate) fn cached_tool_status_snapshot() -> Vec<super::types::ExternalToolStatus> {
    let lock = LATEST_TOOL_STATUS.lock_unpoisoned();
    lock.clone()
}

pub(crate) fn try_begin_tool_status_refresh() -> bool {
    TOOL_STATUS_REFRESH_IN_PROGRESS
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
}

pub(crate) fn finish_tool_status_refresh() {
    TOOL_STATUS_REFRESH_IN_PROGRESS.store(false, Ordering::Release);
}

pub(crate) fn ttl_hit(now_ms: u64, checked_at_ms: Option<u64>, ttl_ms: u64) -> bool {
    checked_at_ms.is_some_and(|checked_at| now_ms.saturating_sub(checked_at) < ttl_ms)
}

pub(crate) fn cached_ffmpeg_release_version() -> Option<String> {
    let cache = FFMPEG_RELEASE_CACHE.lock_unpoisoned();
    cache.as_ref().map(|info| info.version.clone())
}

pub(crate) fn cached_libavif_release_version() -> Option<String> {
    let cache = LIBAVIF_RELEASE_CACHE.lock_unpoisoned();
    cache.as_ref().map(|info| info.version.clone())
}

/// Seed the in-process remote version cache from persisted settings so that
/// update hints remain stable across restarts without requiring a network call
/// on the synchronous tool status path.
pub(crate) fn hydrate_remote_version_cache_from_settings(settings: &ExternalToolSettings) {
    let Some(cache) = settings.remote_version_cache.as_ref() else {
        return;
    };

    if let Some(ffmpeg_static) = cache.ffmpeg_static.as_ref()
        && let (Some(version), Some(tag)) =
            (ffmpeg_static.version.clone(), ffmpeg_static.tag.clone())
    {
        // Do not overwrite an already-populated cache (for example a successful
        // refresh that happened earlier in this process).
        let mut lock = FFMPEG_RELEASE_CACHE.lock_unpoisoned();
        if lock.is_none() {
            *lock = Some(FfmpegStaticRelease { version, tag });
        }
    }

    if let Some(libavif) = cache.libavif.as_ref()
        && let (Some(version), Some(tag)) = (libavif.version.clone(), libavif.tag.clone())
    {
        let mut lock = LIBAVIF_RELEASE_CACHE.lock_unpoisoned();
        if lock.is_none() {
            *lock = Some(LibavifRelease { version, tag });
        }
    }
}

pub(crate) fn update_latest_status_snapshot(statuses: Vec<super::types::ExternalToolStatus>) {
    {
        let mut lock = LATEST_TOOL_STATUS.lock_unpoisoned();
        *lock = statuses;
    }

    // After refreshing the cached snapshot (for example via
    // `TranscodingEngine::external_tool_statuses` after a manual download),
    // immediately emit an event so the frontend sees the latest resolved
    // path/version/update flags instead of a stale pre-download snapshot.
    emit_tool_status_event_if_possible();
}

/// Merge the latest in-memory download runtime state for a single tool into
/// the cached `ExternalToolStatus` snapshot so that subsequent tool-status
/// events can reflect byte counts, progress, speed, and messages without
/// re-probing the filesystem for every tick.
fn merge_download_state_into_latest_snapshot(kind: ExternalToolKind) {
    // Fast path: if we have never produced a snapshot for the frontend (for
    // example because the Settings panel has not been opened yet), there is
    // nothing to merge into and no event should be emitted.
    let runtime = snapshot_download_state(kind);

    let mut lock = LATEST_TOOL_STATUS.lock_unpoisoned();
    if lock.is_empty() {
        return;
    }

    for status in lock.iter_mut() {
        if status.kind == kind {
            status.download_in_progress = runtime.in_progress;
            status.download_progress = runtime.progress;
            status.downloaded_bytes = runtime.downloaded_bytes;
            status.total_bytes = runtime.total_bytes;
            status.bytes_per_second = runtime.bytes_per_second;
            status.last_download_error.clone_from(&runtime.last_error);
            status.last_download_message = runtime.last_message;
            break;
        }
    }
}

fn emit_tool_status_event_if_possible() {
    if let Some(handle) = APP_HANDLE.get() {
        let snapshot = {
            let lock = LATEST_TOOL_STATUS.lock_unpoisoned();
            if lock.is_empty() {
                return;
            }
            lock.clone()
        };
        if let Err(err) = handle.emit(TOOL_STATUS_EVENT_NAME, snapshot) {
            crate::debug_eprintln!("failed to emit external tool status event: {err}");
        }
    }
}

pub(super) fn with_download_state<F, R>(kind: ExternalToolKind, f: F) -> R
where
    F: FnOnce(&mut ToolDownloadRuntimeState) -> R,
{
    let mut map = TOOL_DOWNLOAD_STATE.lock_unpoisoned();
    let entry = map.entry(kind).or_default();
    f(entry)
}

pub(super) fn snapshot_download_state(kind: ExternalToolKind) -> ToolDownloadRuntimeState {
    let map = TOOL_DOWNLOAD_STATE.lock_unpoisoned();
    map.get(&kind).cloned().unwrap_or_default()
}

pub(super) fn mark_download_started(kind: ExternalToolKind, message: String) {
    with_download_state(kind, |state| {
        state.in_progress = true;
        state.progress = None;
        // Until we have actually observed bytes on the wire we keep the
        // counters empty so the UI does not show a misleading "0 B" value.
        state.downloaded_bytes = None;
        state.total_bytes = None;
        state.bytes_per_second = None;
        state.started_at = Some(Instant::now());
        state.last_error = None;
        state.last_message = Some(message);
    });

    // Keep the cached snapshot in sync with the newly started download so
    // that the first event immediately reflects the "in progress" state.
    merge_download_state_into_latest_snapshot(kind);

    // When a download starts, push a fresh status snapshot to the frontend so
    // the Settings panel can immediately reflect the new state.
    emit_tool_status_event_if_possible();
}

/// Mark a download as requested (best-effort) so callers can immediately
/// reflect an in-progress state in the next status snapshot.
///
/// This is intentionally idempotent: if a download is already in progress for
/// the tool, this call is a no-op to avoid resetting progress counters.
pub(crate) fn mark_tool_download_requested(kind: ExternalToolKind, message: String) {
    let already_in_progress = with_download_state(kind, |state| state.in_progress);
    if already_in_progress {
        return;
    }
    mark_download_started(kind, message);
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

        // Compute a 0–100 percentage only when the total size is known.
        // When unknown, keep `progress=None` so the UI shows an indeterminate bar
        // instead of a misleading 0% that appears "stuck" even while speed changes.
        match total {
            Some(total) if total > 0 => {
                let pct = (downloaded as f32 / total as f32) * 100.0;
                let p = pct.clamp(0.0, 100.0);
                state.progress = p.is_finite().then_some(p);
            }
            _ => {
                state.progress = None;
            }
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

    // Push updated progress metrics into the cached snapshot so subsequent
    // events can show smooth, per‑tool progress and byte counters even when
    // multiple tools are downloading in parallel.
    merge_download_state_into_latest_snapshot(kind);

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

    // Synchronise the final 100% snapshot so the UI can briefly show the
    // completed state even after the download thread has finished.
    merge_download_state_into_latest_snapshot(kind);

    // Final event so the UI can flip from “下载中”到“已完成 100%”。
    emit_tool_status_event_if_possible();
}

pub(super) fn mark_download_error(kind: ExternalToolKind, message: String) {
    with_download_state(kind, |state| {
        state.in_progress = false;
        state.last_error = Some(message);
    });

    // Surface the error on the cached snapshot for this tool without
    // disturbing the download state of other tools.
    merge_download_state_into_latest_snapshot(kind);

    // Surface错误给前端，以便在设置页显示失败信息。
    emit_tool_status_event_if_possible();
}

pub(crate) fn clear_tool_remote_check_state(kind: ExternalToolKind) {
    with_download_state(kind, |state| {
        state.last_remote_check_error = None;
        state.last_remote_check_message = None;
        state.last_remote_check_at_ms = None;
    });
}

pub(crate) fn record_tool_remote_check_error(
    kind: ExternalToolKind,
    message: String,
    checked_at_ms: u64,
) {
    with_download_state(kind, |state| {
        state.last_remote_check_error = Some(message);
        state.last_remote_check_message = None;
        state.last_remote_check_at_ms = Some(checked_at_ms);
    });
}

pub(crate) fn record_tool_remote_check_message(
    kind: ExternalToolKind,
    message: String,
    checked_at_ms: u64,
) {
    with_download_state(kind, |state| {
        state.last_remote_check_error = None;
        state.last_remote_check_message = Some(message);
        state.last_remote_check_at_ms = Some(checked_at_ms);
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
    let mut map = LAST_TOOL_DOWNLOAD.lock_unpoisoned();
    map.insert(kind, ToolDownloadMetadata { url, version, tag });
}

pub fn last_tool_download_metadata(
    kind: ExternalToolKind,
) -> Option<(String, Option<String>, Option<String>)> {
    let map = LAST_TOOL_DOWNLOAD.lock_unpoisoned();
    map.get(&kind)
        .map(|m| (m.url.clone(), m.version.clone(), m.tag.clone()))
}

/// 当用户在设置中切换外部工具（例如修改自定义路径或管理模式）
/// 时，清理上一条错误信息与架构不兼容标记，避免旧错误在新配置下“残留”。
pub(crate) fn clear_tool_runtime_error(kind: ExternalToolKind) {
    with_download_state(kind, |state| {
        state.last_error = None;
        state.download_arch_incompatible = false;
        state.path_arch_incompatible = false;
    });
}

/// Seed the in-memory last-download metadata from persisted settings so that
/// `remote_version` / `update_available` flags remain accurate across restarts
/// without requiring a fresh network fetch.
pub fn hydrate_last_tool_download_from_settings(settings: &ExternalToolSettings) {
    let Some(downloaded) = settings.downloaded.as_ref() else {
        return;
    };

    let mut map = LAST_TOOL_DOWNLOAD.lock_unpoisoned();

    let mut seed =
        |kind: ExternalToolKind, info: &Option<crate::ffui_core::settings::DownloadedToolInfo>| {
            let Some(info) = info else {
                return;
            };
            // Do not overwrite fresher runtime metadata (e.g. a download in the
            // current session) with older persisted data.
            if map.contains_key(&kind) {
                return;
            }
            if info.version.is_none() && info.tag.is_none() && info.source_url.is_none() {
                return;
            }
            map.insert(
                kind,
                ToolDownloadMetadata {
                    url: info.source_url.clone().unwrap_or_default(),
                    version: info.version.clone(),
                    tag: info.tag.clone(),
                },
            );
        };

    seed(ExternalToolKind::Ffmpeg, &downloaded.ffmpeg);
    seed(ExternalToolKind::Ffprobe, &downloaded.ffprobe);
    seed(ExternalToolKind::Avifenc, &downloaded.avifenc);
}
