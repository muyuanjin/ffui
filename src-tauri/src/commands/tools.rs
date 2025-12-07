//! System monitoring, tools, and UI commands.
//!
//! Provides commands for:
//! - CPU and GPU usage monitoring
//! - External tool status checking
//! - Media inspection and preview generation
//! - Developer tools and taskbar progress management

use tauri::{AppHandle, State, WebviewWindow};

use crate::ffui_core::tools::{ExternalToolKind, force_download_tool_binary};
use crate::ffui_core::{CpuUsageSnapshot, ExternalToolStatus, GpuUsageSnapshot, TranscodingEngine};
use crate::system_metrics::{MetricsSnapshot, MetricsState};

/// Get the current CPU usage snapshot.
#[tauri::command]
pub fn get_cpu_usage(engine: State<TranscodingEngine>) -> CpuUsageSnapshot {
    engine.cpu_usage()
}

/// Get the current GPU usage snapshot.
#[tauri::command]
pub fn get_gpu_usage(engine: State<TranscodingEngine>) -> GpuUsageSnapshot {
    engine.gpu_usage()
}

/// Get the status of all external tools (FFmpeg, FFprobe, etc.).
#[tauri::command]
pub fn get_external_tool_statuses(engine: State<TranscodingEngine>) -> Vec<ExternalToolStatus> {
    engine.external_tool_statuses()
}

/// Manually trigger download/update for a specific external tool. This is used
/// by the Settings panel "下载 / 更新"按钮 so用户可以在真正跑任务之前提前拉取或更新
/// ffmpeg/ffprobe/avifenc。
#[tauri::command]
pub fn download_external_tool_now(
    engine: State<TranscodingEngine>,
    kind: ExternalToolKind,
) -> Result<Vec<ExternalToolStatus>, String> {
    // 在独立线程中执行实际的下载逻辑，避免在 Tauri 命令线程上做长时间的
    // 网络 I/O（aria2c / reqwest），从而导致整个窗口在“下载 ffmpeg/ffprobe”
    // 时出现假死。
    let engine_clone: TranscodingEngine = (*engine).clone();
    std::thread::Builder::new()
        .name(format!("ffui-tool-download-{kind:?}"))
        .spawn(move || {
            if let Err(err) = force_download_tool_binary(kind) {
                eprintln!("forced download for {kind:?} failed: {err:#}");
            }

            // 下载结束后重新拉取一份状态快照，以便通过
            // TranscodingEngine::external_tool_statuses 更新缓存并向前端推送事件。
            let _ = engine_clone.external_tool_statuses();
        })
        .map_err(|err| format!("failed to spawn tool download thread: {err}"))?;

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
pub fn ack_taskbar_progress(app: AppHandle, engine: State<TranscodingEngine>) {
    let state = engine.queue_state();

    #[cfg(windows)]
    {
        let settings = engine.settings();
        crate::taskbar_progress::acknowledge_taskbar_completion(
            &app,
            &state,
            settings.taskbar_progress_mode,
        );
    }

    #[cfg(not(windows))]
    {
        let _ = (app, state);
    }
}

/// Inspect a media file and return its metadata as JSON.
#[tauri::command]
pub fn inspect_media(engine: State<TranscodingEngine>, path: String) -> Result<String, String> {
    engine.inspect_media(path).map_err(|e| e.to_string())
}

/// Read a generated preview image from disk and return it as a data URL string
/// that can be used directly as an `<img src>` value.
///
/// This provides a robust fallback when the asset protocol fails (for example
/// due to platform quirks), while still constraining reads to the preview
/// images produced by the transcoding engine.
#[tauri::command]
pub fn get_preview_data_url(preview_path: String) -> Result<String, String> {
    use std::fs;
    use std::path::Path;

    let path = Path::new(&preview_path);

    // Best-effort MIME detection based on file extension; we only generate
    // JPEG today but keep this future-proof.
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    let mime = match ext.as_deref() {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    };

    let bytes = fs::read(path).map_err(|e| e.to_string())?;

    use base64::{Engine as _, engine::general_purpose};
    let encoded = general_purpose::STANDARD.encode(&bytes);

    Ok(format!("data:{mime};base64,{encoded}"))
}

/// Given an ordered list of candidate media paths, return the first one that
/// currently exists as a regular file on disk.
///
/// The frontend uses this to make preview/video playback more robust when
/// users delete or rename original/transcoded files after a job has finished:
/// - Completed jobs normally prefer the final output path.
/// - When the output file was deleted but the original input still exists,
///   this helper automatically falls back to the input file.
/// - For in‑flight jobs we can prefer temporary outputs when present.
#[tauri::command]
pub fn select_playable_media_path(candidate_paths: Vec<String>) -> Option<String> {
    use std::path::Path;

    for raw in candidate_paths {
        // Skip empty entries defensively so callers can build lists with
        // optional paths without extra filtering on the JS side.
        if raw.is_empty() {
            continue;
        }

        let path = Path::new(&raw);

        // We only treat existing regular files as playable targets; this
        // avoids accidentally returning directories or other special nodes.
        if path.is_file() {
            return Some(raw);
        }
    }

    None
}

/// Increment the number of active system metrics subscribers.
#[tauri::command]
pub fn metrics_subscribe(metrics: State<MetricsState>) {
    metrics.subscribe();
}

/// Decrement the number of active system metrics subscribers.
#[tauri::command]
pub fn metrics_unsubscribe(metrics: State<MetricsState>) {
    metrics.unsubscribe();
}

/// Return the bounded history of system metrics snapshots for initial charting.
#[tauri::command]
pub fn get_metrics_history(metrics: State<MetricsState>) -> Vec<MetricsSnapshot> {
    metrics.history()
}
