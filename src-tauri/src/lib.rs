mod commands;
mod ffui_core;
mod queue_events;
mod single_instance;
mod system_metrics;

// Taskbar progress APIs are Windows-only; on other platforms we keep the module
// present but empty so `-D warnings` does not fail due to unused helpers.
#[cfg(windows)]
mod taskbar_progress;
#[cfg(not(windows))]
mod taskbar_progress {}

use std::thread;
use std::time::Duration;

use tauri::{
    Emitter,
    Manager,
};

use crate::ffui_core::{
    AutoCompressProgress,
    TranscodingEngine,
    init_child_process_job,
};
use crate::system_metrics::{
    MetricsState,
    spawn_metrics_sampler,
};

// Windows-only: detection +重启逻辑，用于把管理员进程“降权”为普通 UI 进程，
// 这样最终显示出来的窗口始终是非管理员的，可以正常接收 Explorer 的拖拽。
#[cfg(windows)]
mod elevation_shim;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows 下：始终启用降权重启 shim（与之前已验证可用的行为保持一致）。
    // 用户可能通过多种方式手动运行 exe，我们不再尝试 heuristic 判断 dev / release，
    // 只在 shim 内部处理错误并打印日志，避免引入额外的分支 bug。
    #[cfg(windows)]
    {
        if elevation_shim::relaunch_unelevated_if_needed() {
            return;
        }
    }

    let (mut focus_server, _single_instance_guard): (
        Option<single_instance::FocusServer>,
        Option<single_instance::SingleInstanceGuard>,
    ) = match single_instance::ensure_single_instance_or_focus_existing() {
        Ok(single_instance::EnsureOutcome::Primary(primary)) => {
            (primary.focus_server, Some(primary.guard))
        }
        Ok(single_instance::EnsureOutcome::Secondary) => {
            return;
        }
        Err(err) => {
            eprintln!("single-instance guard failed: {err:#}");
            return;
        }
    };

    // 初始化 Job Object，确保子进程在父进程退出时被自动终止
    // 这对于 Windows 平台尤为重要，防止 ffmpeg 进程在 FFUI 被强制关闭后继续运行
    if !init_child_process_job() {
        eprintln!(
            "警告: 无法初始化子进程 Job Object，强制关闭程序时 ffmpeg 进程可能不会被自动终止"
        );
    }

    let engine = TranscodingEngine::new().expect("failed to initialize transcoding engine");
    let metrics_state = MetricsState::default();

    let mut builder = tauri::Builder::default()
        .manage(engine)
        .manage(metrics_state.clone())
        .manage(commands::ui_fonts::UiFontDownloadManager::default());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::queue::get_queue_state,
            commands::queue::get_queue_state_lite,
            commands::queue::enqueue_transcode_job,
            commands::queue::enqueue_transcode_jobs,
            commands::queue::expand_manual_job_inputs,
            commands::queue::cancel_transcode_job,
            commands::queue::wait_transcode_job,
            commands::queue::resume_transcode_job,
            commands::queue::restart_transcode_job,
            commands::queue::delete_transcode_job,
            commands::queue::delete_batch_compress_batch,
            commands::queue::reorder_queue,
            commands::queue::get_job_detail,
            commands::job_compare::get_job_compare_sources,
            commands::job_compare::extract_job_compare_frame,
            commands::job_compare::extract_job_compare_concat_frame,
            commands::output::preview_output_path,
            commands::presets::get_presets,
            commands::presets::get_smart_default_presets,
            commands::presets::save_preset,
            commands::presets::delete_preset,
            commands::presets::reorder_presets,
            commands::settings::get_app_settings,
            commands::settings::save_app_settings,
            commands::settings::get_batch_compress_defaults,
            commands::settings::save_batch_compress_defaults,
            commands::settings::run_auto_compress,
            commands::ui_fonts::get_system_font_families,
            commands::ui_fonts::list_open_source_fonts,
            commands::ui_fonts::start_open_source_font_download,
            commands::ui_fonts::get_open_source_font_download_snapshot,
            commands::ui_fonts::cancel_open_source_font_download,
            commands::ui_fonts::ensure_open_source_font_downloaded,
            commands::ui_fonts::import_ui_font_file,
            commands::updater::get_app_updater_capabilities,
            commands::updater::prepare_app_updater_proxy,
            commands::tools::get_cpu_usage,
            commands::tools::get_gpu_usage,
            commands::tools::get_external_tool_statuses,
            commands::tools::get_external_tool_statuses_cached,
            commands::tools::refresh_external_tool_statuses_async,
            commands::tools::get_external_tool_candidates,
            commands::tools::download_external_tool_now,
            commands::tools::open_devtools,
            commands::tools::ack_taskbar_progress,
            commands::tools::inspect_media,
            commands::tools::get_preview_data_url,
            commands::tools::fallback_preview::extract_fallback_preview_frame,
            commands::tools::fallback_preview::cleanup_fallback_preview_frames_async,
            commands::tools::preview_cache::cleanup_preview_caches_async,
            commands::tools::ensure_job_preview,
            commands::tools::playable_media::select_playable_media_path,
            commands::tools::reveal_path_in_folder,
            commands::tools::metrics_subscribe,
            commands::tools::metrics_unsubscribe,
            commands::tools::get_metrics_history,
            commands::tools::get_transcode_activity_today
        ])
        // Fallback: if the frontend never calls `window.show()` (e.g. crash during boot),
        // ensure the main window becomes visible after a short timeout so the app is not "dead".
        .setup(move |app| {
            #[cfg(desktop)]
            {
                if commands::updater::updater_is_configured(app.config()) {
                    app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                } else {
                    eprintln!("tauri-plugin-updater disabled: missing/placeholder updater pubkey or endpoints");
                }
            }

            if let Some(server) = focus_server.take() {
                server.spawn(app.handle().clone());
            }

            #[cfg(windows)]
            {
                use windows::Win32::Foundation::HWND;
                use windows::Win32::UI::WindowsAndMessaging::{
                    CHANGEFILTERSTRUCT,
                    ChangeWindowMessageFilterEx,
                    MSGFLT_ALLOW,
                    WINDOW_MESSAGE_FILTER_ACTION,
                    WM_COPYDATA,
                    WM_DROPFILES,
                };

                if let Some(window) = app.get_webview_window("main")
                    && let Ok(hwnd) = window.hwnd()
                {
                    // 允许低完整性进程（如普通权限的 Explorer）把拖拽相关消息发给当前窗口，
                    // 这样即使该窗口是管理员权限，也不会被 UIPI 拦截拖拽。
                    //
                    // 参考：
                    // - https://helgeklein.com/blog/how-to-enable-drag-and-drop-for-an-elevated-mfc-application-on-vistawindows-7/
                    // 需要放行的消息包括：
                    //   WM_DROPFILES、WM_COPYDATA 和 0x0049（内部的 WM_COPYGLOBALDATA）。
                    unsafe {
                        let mut filter: CHANGEFILTERSTRUCT =
                            CHANGEFILTERSTRUCT { cbSize: std::mem::size_of::<CHANGEFILTERSTRUCT>() as u32, ExtStatus: Default::default() };

                        let hwnd = HWND(hwnd.0);
                        let messages: [u32; 3] = [WM_DROPFILES, WM_COPYDATA, 0x0049];

                        for msg in messages {
                            filter.cbSize = std::mem::size_of::<CHANGEFILTERSTRUCT>() as u32;
                            filter.ExtStatus = Default::default();
                            let _ = ChangeWindowMessageFilterEx(hwnd, msg, WINDOW_MESSAGE_FILTER_ACTION(MSGFLT_ALLOW.0), Some(&mut filter));
                        }
                    }
                }
            }

            let handle = app.handle().clone();

            // Wire the tools runtime_state module with the global AppHandle so
            // it can emit ffui://external-tool-status events whenever a tool
            // download starts/progresses/completes/fails.
            //
            // 注意：这里刻意不在启动阶段调用 engine.external_tool_statuses()，
            // 避免在 Tauri setup 阶段做同步网络请求或外部进程探测，从而在网络
            // 不通/磁盘慢时阻塞应用启动，看起来像“程序卡死”。
            //
            // 初始快照由前端通过 get_external_tool_statuses_cached 快速读取，
            // 真正的刷新由 refresh_external_tool_statuses_async 在后台执行，
            // 完成后通过 ffui://external-tool-status 事件推送更新。
            {
                crate::ffui_core::tools::set_tool_event_app_handle(app.handle().clone());
            }

            // Wire the monitor activity emitter with the global AppHandle so
            // the transcoding engine can push ffui://transcode-activity-today
            // events when hourly buckets flip.
            {
                crate::ffui_core::set_transcode_activity_app_handle(app.handle().clone());
            }

            // Stream queue state changes from the Rust engine to the frontend via
            // a long-lived Tauri event so the UI does not need to poll.
            queue_events::register_queue_stream(&handle);

            // Stream Batch Compress progress snapshots so the frontend can show
            // coarse-grained scanning progress for large directory trees.
            {
                let engine = app.state::<TranscodingEngine>();
                let event_handle = handle.clone();
                engine.register_batch_compress_listener(move |progress: AutoCompressProgress| {
                    if let Err(err) = event_handle.emit("auto-compress://progress", progress.clone()) {
                        eprintln!("failed to emit auto-compress progress event: {err}");
                    }
                });
            }

            // Start the system metrics sampler on Tauri's async runtime. The
            // sampler keeps a bounded in-memory history and only performs
            // high-frequency sampling while there is at least one subscriber
            // on the frontend.
            {
                let app_handle = handle.clone();
                spawn_metrics_sampler(app_handle, metrics_state.clone());
            }

            // Fallback: ensure the window becomes visible even if the frontend
            // never calls `window.show()` (for example when boot crashes).
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(10));
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use crate::commands::tools::get_preview_data_url;
    use crate::commands::tools::playable_media::select_playable_media_path;

    #[test]
    fn get_preview_data_url_builds_data_url_prefix() {
        use std::fs;
        use std::time::{
            SystemTime,
            UNIX_EPOCH,
        };

        // Write a small dummy JPEG-like payload into the previews directory and
        // ensure the helper returns a data URL with the expected prefix.
        let preview_root = crate::commands::tools::preview_root_dir_for_tests();
        let _ = fs::create_dir_all(&preview_root);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let path = preview_root.join(format!("ffui_test_preview_{timestamp}.jpg"));

        fs::write(&path, b"dummy-preview-bytes").expect("failed to write preview test file");

        let url = get_preview_data_url(path.to_string_lossy().into_owned())
            .expect("preview data url generation must succeed for readable file");

        assert!(
            url.starts_with("data:image/jpeg;base64,"),
            "preview data url must start with JPEG data URL prefix, got: {url}"
        );
    }

    #[test]
    fn select_playable_media_path_prefers_first_existing_candidate() {
        use std::fs;
        use std::time::{
            SystemTime,
            UNIX_EPOCH,
        };

        // Create a temporary file on disk so we can exercise the helper against
        // both missing and existing candidates without relying on any fixed
        // paths on the user's system.
        let tmp_dir = std::env::temp_dir();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let existing_path = tmp_dir.join(format!("ffui_test_playable_{timestamp}.mp4"));

        fs::write(&existing_path, b"dummy-bytes").expect("failed to write preview candidate");

        let missing_path = existing_path.with_extension("missing.mp4");

        let candidates = vec![
            missing_path.to_string_lossy().into_owned(),
            existing_path.to_string_lossy().into_owned(),
        ];

        let selected = select_playable_media_path(candidates)
            .expect("select_playable_media_path must return Some for existing file");

        assert_eq!(
            selected,
            existing_path.to_string_lossy(),
            "select_playable_media_path must skip missing files and return the first existing candidate"
        );

        let _ = fs::remove_file(&existing_path);
    }

    #[test]
    fn select_playable_media_path_trims_and_picks_existing_file() {
        use std::fs;
        use std::time::{
            SystemTime,
            UNIX_EPOCH,
        };

        let tmp_dir = std::env::temp_dir();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let existing_path = tmp_dir.join(format!("ffui_test_playable_trim_{timestamp}.mp4"));

        fs::write(&existing_path, b"dummy-bytes").expect("failed to write preview candidate");

        let padded = format!("  {}  ", existing_path.to_string_lossy());

        let selected = select_playable_media_path(vec![padded, " ".to_string()])
            .expect("select_playable_media_path must ignore padding and pick existing file");

        assert_eq!(
            selected,
            existing_path.to_string_lossy(),
            "select_playable_media_path should return the trimmed existing path"
        );

        let _ = fs::remove_file(&existing_path);
    }

    #[test]
    fn select_playable_media_path_falls_back_to_first_non_empty_candidate() {
        use std::time::{
            SystemTime,
            UNIX_EPOCH,
        };

        let tmp_dir = std::env::temp_dir();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let missing = tmp_dir.join(format!("ffui_test_playable_missing_{timestamp}.mp4"));
        let missing_str = missing.to_string_lossy().into_owned();

        let selected =
            select_playable_media_path(vec![missing_str.clone(), "".to_string(), "  ".to_string()]);

        assert_eq!(
            selected,
            Some(missing_str),
            "even when stat fails the helper should return the first non-empty candidate"
        );
    }

    #[test]
    fn asset_protocol_scope_aligns_with_opener_allowlist_and_ui_fonts() {
        use std::fs;
        use std::path::PathBuf;

        use serde_json::Value;

        let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());

        let tauri_conf_path = manifest_dir.join("tauri.conf.json");
        let tauri_conf_raw =
            fs::read_to_string(&tauri_conf_path).expect("failed to read src-tauri/tauri.conf.json");
        let tauri_conf: Value =
            serde_json::from_str(&tauri_conf_raw).expect("tauri.conf.json must be valid JSON");

        let scope = tauri_conf
            .get("app")
            .and_then(|v| v.get("security"))
            .and_then(|v| v.get("assetProtocol"))
            .and_then(|v| v.get("scope"))
            .and_then(|v| v.as_array())
            .expect("expected app.security.assetProtocol.scope to be an array");

        let scope_set: BTreeSet<String> = scope
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();

        assert!(
            !scope_set.contains("**") && !scope_set.contains("*"),
            "assetProtocol.scope must not contain a global wildcard: {scope_set:?}"
        );

        let capabilities_path = manifest_dir.join("capabilities").join("default.json");
        let capabilities_raw = fs::read_to_string(&capabilities_path)
            .expect("failed to read src-tauri/capabilities/default.json");
        let capabilities: Value = serde_json::from_str(&capabilities_raw)
            .expect("capabilities/default.json must be valid JSON");

        let permissions = capabilities
            .get("permissions")
            .and_then(|v| v.as_array())
            .expect("capabilities/default.json permissions must be an array");

        let opener_allow_paths: BTreeSet<String> = permissions
            .iter()
            .find(|p| p.get("identifier") == Some(&Value::String("opener:allow-open-path".into())))
            .and_then(|p| p.get("allow"))
            .and_then(|v| v.as_array())
            .expect("expected opener:allow-open-path allowlist")
            .iter()
            .filter_map(|entry| {
                entry
                    .get("path")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .collect();

        let mut expected = opener_allow_paths;
        expected.insert("**/*.[tT][tT][fF]".to_string());
        expected.insert("**/*.[oO][tT][fF]".to_string());

        assert_eq!(
            scope_set, expected,
            "assetProtocol.scope must align with opener:allow-open-path (+ ui fonts)"
        );
    }
}
