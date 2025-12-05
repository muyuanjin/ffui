//! System monitoring, tools, and UI commands.
//!
//! Provides commands for:
//! - CPU and GPU usage monitoring
//! - External tool status checking
//! - Media inspection and preview generation
//! - Developer tools and taskbar progress management

use tauri::{AppHandle, State, WebviewWindow};

use crate::ffui_core::{CpuUsageSnapshot, ExternalToolStatus, GpuUsageSnapshot, TranscodingEngine};

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
