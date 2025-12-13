//! System monitoring, tools, and UI commands.
//!
//! Provides commands for:
//! - CPU and GPU usage monitoring
//! - External tool status checking
//! - Media inspection and preview generation
//! - Developer tools and taskbar progress management

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State, WebviewWindow};

use crate::ffui_core::tools::{ExternalToolKind, force_download_tool_binary, verify_tool_binary};
use crate::ffui_core::{
    CpuUsageSnapshot, ExternalToolCandidate, ExternalToolStatus, GpuUsageSnapshot,
    TranscodeActivityToday, TranscodingEngine,
};
use crate::system_metrics::{MetricsSnapshot, MetricsState};

mod reveal;

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

/// Get the latest cached snapshot of external tool statuses.
///
/// This is safe to call on the startup UI path and MUST NOT trigger any
/// network I/O or external process probing.
#[tauri::command]
pub fn get_external_tool_statuses_cached(
    engine: State<TranscodingEngine>,
) -> Vec<ExternalToolStatus> {
    engine.external_tool_statuses_cached()
}

/// Trigger an async refresh of external tool statuses.
///
/// Returns true when a new refresh task was started, false when deduped.
#[tauri::command]
pub fn refresh_external_tool_statuses_async(
    engine: State<TranscodingEngine>,
    remote_check: Option<bool>,
    manual_remote_check: Option<bool>,
) -> bool {
    engine.refresh_external_tool_statuses_async(
        remote_check.unwrap_or(false),
        manual_remote_check.unwrap_or(false),
    )
}

/// Enumerate all verified candidate binaries for a specific external tool.
///
/// This is used by the Settings panel when multiple executables are
/// available (for example a system PATH binary and an auto-downloaded
/// static build) so that users can explicitly choose which one to use.
#[tauri::command]
pub fn get_external_tool_candidates(
    engine: State<TranscodingEngine>,
    kind: ExternalToolKind,
) -> Vec<ExternalToolCandidate> {
    let settings = engine.settings();
    crate::ffui_core::tools::tool_candidates(kind, &settings.tools)
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
            match force_download_tool_binary(kind) {
                Ok(path) => {
                    if let Some(path_str) = path.to_str() {
                        // 在持久化之前先做一次轻量级的可执行性校验，避免把无法
                        // 运行的二进制写入 settings.json，导致后续任务始终优先
                        // 命中一条坏路径。
                        if verify_tool_binary(path_str, kind, "download") {
                            engine_clone.record_manual_tool_download(kind, path_str);
                        } else {
                            eprintln!(
                                "forced download for {kind:?} produced a binary that failed verification at {path_str}"
                            );
                        }
                    }
                }
                Err(err) => {
                    eprintln!("forced download for {kind:?} failed: {err:#}");
                }
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
            settings.taskbar_progress_scope,
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

    let trimmed = preview_path.trim();
    if trimmed.is_empty() {
        return Err("preview_path is empty".to_string());
    }

    let path = Path::new(trimmed);

    let canonical =
        fs::canonicalize(path).map_err(|e| format!("preview_path is not a readable file: {e}"))?;

    let preview_root = preview_root_dir_for_security()?;
    let preview_root_canon = fs::canonicalize(&preview_root).unwrap_or(preview_root.clone());

    if !canonical.starts_with(&preview_root_canon) {
        return Err("preview_path is outside the previews directory".to_string());
    }

    // Best-effort MIME detection based on file extension; we only generate
    // JPEG today but keep this future-proof.
    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    let mime = match ext.as_deref() {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => "image/jpeg",
    };

    // Only allow known preview image extensions.
    if !matches!(
        ext.as_deref(),
        Some("jpg") | Some("jpeg") | Some("png") | Some("webp")
    ) {
        return Err("preview_path is not a supported preview image type".to_string());
    }

    let bytes = fs::read(&canonical).map_err(|e| e.to_string())?;

    use base64::{Engine as _, engine::general_purpose};
    let encoded = general_purpose::STANDARD.encode(&bytes);

    Ok(format!("data:{mime};base64,{encoded}"))
}

fn preview_root_dir_for_security() -> Result<PathBuf, String> {
    use std::env;

    let exe = env::current_exe().map_err(|e| format!("current_exe failed: {e}"))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "current_exe has no parent directory".to_string())?;
    let exe_dir_canon = exe_dir
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize exe directory: {e}"))?;
    Ok(exe_dir_canon.join("previews"))
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
pub fn ensure_job_preview(engine: State<TranscodingEngine>, job_id: String) -> Option<String> {
    engine.ensure_job_preview(&job_id)
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
    use std::fs;
    use std::path::Path;

    // 记录首个非空候选，若所有存在性检查都失败仍可兜底返回，避免前端拿到 None。
    let mut first_non_empty: Option<String> = None;

    for raw in candidate_paths {
        // 允许调用方传入带空白的路径（例如用户复制粘贴时留下的空格），这里统一去除前后空白。
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }

        let candidate = trimmed.to_string();
        if first_non_empty.is_none() {
            first_non_empty = Some(candidate.clone());
        }

        let path = Path::new(&candidate);

        // We only treat existing regular files as playable targets; this
        // avoids accidentally returning directories or other special nodes.
        let mut metadata = fs::metadata(path);

        // Windows 在超长路径或 UNC 路径下容易因为缺少 \\?\ 前缀导致 is_file 误判，
        // 失败时尝试一次扩展路径再检查，尽量减少“明明存在却判定不存在”的情况。
        #[cfg(windows)]
        if metadata.is_err()
            && let Some(long_path) = build_windows_extended_path(path)
        {
            metadata = fs::metadata(&long_path);
        }

        match metadata {
            Ok(meta) if meta.is_file() => return Some(candidate),
            Ok(_) => continue,
            Err(err) => {
                eprintln!("select_playable_media_path: 跳过不可用路径 {candidate}: {err}");
            }
        }
    }

    first_non_empty
}

/// 在 Windows 上为路径加上扩展长度前缀，避免超长/UNC 路径在常规 API 下判定失败。
#[cfg(windows)]
fn build_windows_extended_path(path: &Path) -> Option<PathBuf> {
    use std::path::PathBuf;

    let raw = path.to_string_lossy();

    // 已经是扩展路径则直接返回 None，让调用方保持原有错误。
    if raw.starts_with(r"\\?\") {
        return None;
    }

    // 统一使用反斜杠，避免混合分隔符导致的奇怪路径。
    let normalized = raw.replace('/', "\\");

    if normalized.starts_with(r"\\") {
        // UNC 形如 \\server\share\path => \\?\UNC\server\share\path
        let trimmed = normalized.trim_start_matches('\\');
        return Some(PathBuf::from(format!(r"\\?\UNC\{trimmed}")));
    }

    // 普通盘符路径形如 C:\path => \\?\C:\path
    Some(PathBuf::from(format!(r"\\?\{normalized}")))
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
        let path = tmp_dir.join(format!("ffui_test_outside_{timestamp}.jpg"));

        fs::write(&path, b"dummy-bytes").expect("failed to write outside preview file");

        let err = get_preview_data_url(path.to_string_lossy().into_owned())
            .expect_err("outside preview paths must be rejected");
        assert!(
            err.contains("outside the previews directory"),
            "unexpected error message for outside preview path: {err}"
        );
    }
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

/// Return today's transcode activity buckets for the Monitor heatmap.
#[tauri::command]
pub fn get_transcode_activity_today(engine: State<TranscodingEngine>) -> TranscodeActivityToday {
    engine.transcode_activity_today()
}
