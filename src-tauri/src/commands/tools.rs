//! System monitoring, tools, and UI commands.
//!
//! Provides commands for:
//! - CPU and GPU usage monitoring
//! - External tool status checking
//! - Media inspection and preview generation
//! - Developer tools and taskbar progress management

#![allow(clippy::redundant_pub_crate)]

use std::path::PathBuf;

use tauri::{AppHandle, State, WebviewWindow};

use crate::ffui_core::tools::{
    ExternalToolKind, force_download_tool_binary, mark_tool_download_requested, verify_tool_binary,
};
use crate::ffui_core::{
    CpuUsageSnapshot, ExternalToolCandidate, ExternalToolStatus, GpuUsageSnapshot,
    TranscodeActivityToday, TranscodingEngine,
};
use crate::system_metrics::{MetricsSnapshot, MetricsState};

pub(crate) mod fallback_preview;
pub(crate) mod playable_media;
pub(crate) mod preview_cache;
mod reveal;

/// Get the current CPU usage snapshot.
#[tauri::command]
pub fn get_cpu_usage(engine: State<'_, TranscodingEngine>) -> CpuUsageSnapshot {
    engine.cpu_usage()
}

/// Get the current GPU usage snapshot.
#[tauri::command]
pub fn get_gpu_usage(engine: State<'_, TranscodingEngine>) -> GpuUsageSnapshot {
    engine.gpu_usage()
}

/// Get the status of all external tools (`FFmpeg`, `FFprobe`, etc.).
#[tauri::command]
pub fn get_external_tool_statuses(engine: State<'_, TranscodingEngine>) -> Vec<ExternalToolStatus> {
    engine.external_tool_statuses()
}

/// Get the latest cached snapshot of external tool statuses.
///
/// This is safe to call on the startup UI path and MUST NOT trigger any
/// network I/O or external process probing.
#[tauri::command]
pub fn get_external_tool_statuses_cached(
    engine: State<'_, TranscodingEngine>,
) -> Vec<ExternalToolStatus> {
    engine.external_tool_statuses_cached()
}

/// Trigger an async refresh of external tool statuses.
///
/// Returns true when a new refresh task was started, false when deduped.
#[tauri::command]
pub fn refresh_external_tool_statuses_async(
    engine: State<'_, TranscodingEngine>,
    remote_check: Option<bool>,
    manual_remote_check: Option<bool>,
    remote_check_kind: Option<ExternalToolKind>,
) -> bool {
    engine.refresh_external_tool_statuses_async(
        remote_check.unwrap_or(false),
        manual_remote_check.unwrap_or(false),
        remote_check_kind,
    )
}

/// Enumerate all verified candidate binaries for a specific external tool.
///
/// This is used by the Settings panel when multiple executables are
/// available (for example a system PATH binary and an auto-downloaded
/// static build) so that users can explicitly choose which one to use.
#[tauri::command]
pub async fn get_external_tool_candidates(
    engine: State<'_, TranscodingEngine>,
    kind: ExternalToolKind,
) -> Result<Vec<ExternalToolCandidate>, String> {
    let tools_settings = engine.settings().tools;
    tauri::async_runtime::spawn_blocking(move || {
        crate::ffui_core::tools::tool_candidates(kind, &tools_settings)
    })
    .await
    .map_err(|err| format!("failed to enumerate external tool candidates: {err}"))
}

/// Manually trigger download/update for a specific external tool. This is used
/// by the Settings panel "下载 / 更新"按钮 so用户可以在真正跑任务之前提前拉取或更新
/// ffmpeg/ffprobe/avifenc。
#[tauri::command]
pub fn download_external_tool_now(
    engine: State<'_, TranscodingEngine>,
    kind: ExternalToolKind,
) -> Result<Vec<ExternalToolStatus>, String> {
    // 在独立线程中执行实际的下载逻辑，避免在 Tauri 命令线程上做长时间的
    // 网络 I/O（aria2c / reqwest），从而导致整个窗口在“下载 ffmpeg/ffprobe”
    // 时出现假死。
    let engine_clone: TranscodingEngine = (*engine).clone();
    std::thread::Builder::new()
        .name(format!("ffui-tool-download-{kind:?}"))
        .spawn(move || {
            match force_download_tool_binary(kind) {
                Ok(path) => {
                    if let Some(path_str) = path.to_str() {
                        // 在持久化之前先做一次轻量级的可执行性校验，避免把无法
                        // 运行的二进制写入 settings.json，导致后续任务始终优先
                        // 命中一条坏路径。
                        if verify_tool_binary(path_str, kind, "download") {
                            engine_clone.record_manual_tool_download(kind, path_str);
                        } else {
                            crate::debug_eprintln!(
                                "forced download for {kind:?} produced a binary that failed verification at {path_str}"
                            );
                        }
                    }
                }
                Err(err) => {
                    crate::debug_eprintln!("forced download for {kind:?} failed: {err:#}");
                }
            }

            // 下载结束后重新拉取一份状态快照，以便通过
            // TranscodingEngine::external_tool_statuses 更新缓存并向前端推送事件。
            drop(engine_clone.external_tool_statuses());
        })
        .map_err(|err| format!("failed to spawn tool download thread: {err}"))?;

    let tool_name = match kind {
        ExternalToolKind::Ffmpeg => "ffmpeg",
        ExternalToolKind::Ffprobe => "ffprobe",
        ExternalToolKind::Avifenc => "avifenc",
    };
    mark_tool_download_requested(kind, format!("starting auto-download for {tool_name}"));

    // 立即返回当前的状态快照，确保前端调用不会被下载流程阻塞。
    Ok(engine.external_tool_statuses())
}

/// Open the webview developer tools for the calling window.
///
/// In debug builds this forwards to `WebviewWindow::open_devtools`. In
/// release builds without the `devtools` feature, this is a no-op so that
/// the command remains safe to call but does not accidentally enable
/// devtools in production.
#[tauri::command]
pub fn open_devtools(window: WebviewWindow) {
    window.open_devtools();
}

/// Explicitly clear a completed taskbar progress bar once the user has
/// acknowledged it by focusing/clicking the main window. On non-Windows
/// platforms this is a no-op, but we still expose the command so the
/// frontend can call it unconditionally.
#[tauri::command]
pub fn ack_taskbar_progress(app: AppHandle, engine: State<'_, TranscodingEngine>) {
    let state = engine.queue_state();

    #[cfg(windows)]
    {
        let settings = engine.settings();
        crate::taskbar_progress::acknowledge_taskbar_completion(
            &app,
            &state,
            settings.taskbar_progress_mode,
            settings.taskbar_progress_scope,
        );
    }

    #[cfg(not(windows))]
    {
        drop((app, state));
    }
}

/// Inspect a media file and return its metadata as JSON.
#[tauri::command]
pub async fn inspect_media(
    engine: State<'_, TranscodingEngine>,
    path: String,
) -> Result<String, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.inspect_media(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read a generated preview image from disk and return it as a data URL string
/// that can be used directly as an `<img src>` value.
///
/// This provides a robust fallback when the asset protocol fails (for example
/// due to platform quirks), while still constraining reads to the preview
/// images produced by the transcoding engine.
#[tauri::command]
pub async fn get_preview_data_url(preview_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || get_preview_data_url_impl(preview_path))
        .await
        .map_err(|e| e.to_string())?
}

fn get_preview_data_url_impl(preview_path: String) -> Result<String, String> {
    use std::fs;
    use std::path::Path;

    use base64::Engine as _;
    use base64::engine::general_purpose;

    let trimmed = preview_path.trim();
    if trimmed.is_empty() {
        return Err("preview_path is empty".to_string());
    }

    let path = Path::new(trimmed);

    let canonical =
        fs::canonicalize(path).map_err(|e| format!("preview_path is not a readable file: {e}"))?;

    let preview_root = preview_root_dir_for_security()?;
    let preview_root_canon = fs::canonicalize(&preview_root).unwrap_or(preview_root);

    if !canonical.starts_with(&preview_root_canon) {
        return Err("preview_path is outside the previews directory".to_string());
    }

    // Best-effort MIME detection based on file extension; we only generate
    // JPEG today but keep this future-proof.
    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    let mime = match ext.as_deref() {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    };

    // Only allow known preview image extensions.
    if !matches!(ext.as_deref(), Some("jpg" | "jpeg" | "png" | "webp")) {
        return Err("preview_path is not a supported preview image type".to_string());
    }

    let bytes = fs::read(&canonical).map_err(|e| e.to_string())?;

    let encoded = general_purpose::STANDARD.encode(&bytes);

    Ok(format!("data:{mime};base64,{encoded}"))
}

fn preview_root_dir_for_security() -> Result<PathBuf, String> {
    crate::ffui_core::previews_dir().map_err(|e| e.to_string())
}

#[cfg(test)]
pub(crate) fn preview_root_dir_for_tests() -> PathBuf {
    preview_root_dir_for_security().unwrap_or_else(|_| PathBuf::from("previews"))
}

/// Ensure a job's preview image exists and is readable.
///
/// When a user deletes the preview image from disk, this regenerates a fresh
/// preview using the latest capture percent setting.
#[tauri::command]
pub async fn ensure_job_preview(
    engine: State<'_, TranscodingEngine>,
    job_id: String,
) -> Result<Option<String>, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || Ok(engine.ensure_job_preview(&job_id)))
        .await
        .map_err(|e| e.to_string())?
}

/// Ensure a preview thumbnail variant exists for the given job and size.
///
/// Unlike `ensure_job_preview`, this does not mutate queue state or update the
/// job's `previewPath`; it only returns a cached filesystem path.
#[tauri::command]
pub async fn ensure_job_preview_variant(
    engine: State<'_, TranscodingEngine>,
    job_id: String,
    height_px: u16,
) -> Result<Option<String>, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.ensure_job_preview_variant(&job_id, height_px)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open the system file manager for the given path and select/highlight the
/// file when supported by the platform.
#[tauri::command]
pub fn reveal_path_in_folder(path: String) -> Result<(), String> {
    reveal::reveal_path_in_folder_impl(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_preview_data_url_rejects_paths_outside_preview_root() {
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let tmp_dir = std::env::temp_dir();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let data_root = tmp_dir.join(format!("ffui_test_data_root_{timestamp}"));
        let preview_root = data_root.join("previews");
        drop(fs::create_dir_all(&preview_root));
        let data_root_guard = crate::ffui_core::override_data_root_dir_for_tests(data_root);
        let path = tmp_dir.join(format!("ffui_test_outside_{timestamp}.jpg"));

        fs::write(&path, b"dummy-bytes").expect("failed to write outside preview file");

        let err = get_preview_data_url_impl(path.to_string_lossy().into_owned())
            .expect_err("outside preview paths must be rejected");
        assert!(
            err.contains("outside the previews directory"),
            "unexpected error message for outside preview path: {err}"
        );
        drop(data_root_guard);
    }
}

/// Increment the number of active system metrics subscribers.
#[tauri::command]
pub fn metrics_subscribe(metrics: State<'_, MetricsState>) {
    metrics.subscribe();
}

/// Decrement the number of active system metrics subscribers.
#[tauri::command]
pub fn metrics_unsubscribe(metrics: State<'_, MetricsState>) {
    metrics.unsubscribe();
}

/// Return the bounded history of system metrics snapshots for initial charting.
#[tauri::command]
pub fn get_metrics_history(metrics: State<'_, MetricsState>) -> Vec<MetricsSnapshot> {
    metrics.history()
}

/// Return today's transcode activity buckets for the Monitor heatmap.
#[tauri::command]
pub fn get_transcode_activity_today(
    engine: State<'_, TranscodingEngine>,
) -> TranscodeActivityToday {
    engine.transcode_activity_today()
}
