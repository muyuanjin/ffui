#[macro_export]
macro_rules! debug_eprintln {
    ($($arg:tt)*) => {{
        #[cfg(debug_assertions)]
        {
            eprintln!($($arg)*);
        }
        // In release builds we still want the arguments to be "used" so we
        // don't get unused variable/import warnings, but we do not want to
        // evaluate potentially expensive formatting expressions.
        #[cfg(not(debug_assertions))]
        {
            let _ = || {
                let _ = format_args!($($arg)*);
            };
        }
    }};
}

mod app_exit;
mod commands;
mod ffui_core;
mod queue_events;
mod single_instance;
mod sync_ext;
mod system_metrics;

#[cfg(test)]
pub mod test_support;

// Expose queue-lite types for tooling/bench binaries without making the entire
// `ffui_core` module part of the public API surface.
pub use crate::ffui_core::{
    JobSource, JobStatus, JobType, QueueStateLite, QueueStateLiteDelta, TranscodeJobLite,
    TranscodeJobLiteDeltaPatch,
};

// Taskbar progress APIs are Windows-only; on other platforms we keep the module
// present but empty so `-D warnings` does not fail due to unused helpers.
#[cfg(windows)]
mod taskbar_progress;
#[cfg(not(windows))]
mod taskbar_progress {}

use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::ffui_core::{AutoCompressProgress, TranscodingEngine, init_child_process_job};
use crate::sync_ext::MutexExt;
use crate::system_metrics::{MetricsState, spawn_metrics_sampler};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitRequestPayload {
    processing_job_count: usize,
    timeout_seconds: f64,
}

fn exit_auto_wait_snapshot(engine: &TranscodingEngine) -> (bool, f64, Vec<String>) {
    let state = engine.inner.state.lock_unpoisoned();
    let processing_job_ids: Vec<String> = state
        .jobs
        .values()
        .filter(|job| job.status == JobStatus::Processing)
        .map(|job| job.id.clone())
        .collect();
    (
        state.settings.exit_auto_wait_enabled,
        state.settings.exit_auto_wait_timeout_seconds,
        processing_job_ids,
    )
}

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
            crate::debug_eprintln!("single-instance guard failed: {err:#}");
            return;
        }
    };

    // 初始化 Job Object，确保子进程在父进程退出时被自动终止
    // 这对于 Windows 平台尤为重要，防止 ffmpeg 进程在 FFUI 被强制关闭后继续运行
    if !init_child_process_job() {
        crate::debug_eprintln!(
            "警告: 无法初始化子进程 Job Object，强制关闭程序时 ffmpeg 进程可能不会被自动终止"
        );
    }

    let metrics_state = MetricsState::default();

    let mut builder = tauri::Builder::default()
        .manage(metrics_state.clone())
        .manage(commands::ui_fonts::UiFontDownloadManager::default());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    let app = builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::app_exit::reset_exit_prompt,
            commands::app_exit::exit_app_now,
            commands::app_exit::exit_app_with_auto_wait,
            commands::queue::get_queue_state,
            commands::queue::get_queue_state_lite,
            commands::queue::get_queue_startup_hint,
            commands::queue::resume_startup_queue,
            commands::queue::dismiss_queue_startup_hint,
            commands::queue::enqueue_transcode_job,
            commands::queue::enqueue_transcode_jobs,
            commands::queue::expand_manual_job_inputs,
            commands::queue::cancel_transcode_job,
            commands::queue::wait_transcode_job,
            commands::queue::wait_transcode_jobs_bulk,
            commands::queue::resume_transcode_job,
            commands::queue::restart_transcode_job,
            commands::queue::delete_transcode_job,
            commands::queue::delete_transcode_jobs_bulk,
            commands::queue::delete_batch_compress_batch,
            commands::queue::delete_batch_compress_batches_bulk,
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
            commands::presets::export_presets_bundle,
            commands::presets::read_presets_bundle,
            commands::settings::get_app_settings,
            commands::settings::save_app_settings,
            commands::settings::get_batch_compress_defaults,
            commands::settings::save_batch_compress_defaults,
            commands::settings::run_auto_compress,
            commands::data_root::get_data_root_info,
            commands::data_root::set_data_root_mode,
            commands::data_root::acknowledge_data_root_fallback_notice,
            commands::data_root::open_data_root_dir,
            commands::data_root::export_config_bundle,
            commands::data_root::import_config_bundle,
            commands::data_root::clear_all_app_data,
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
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let tauri::WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };

            let coordinator = window.app_handle().state::<app_exit::ExitCoordinator>();
            if coordinator.is_exit_allowed() {
                return;
            }

            let engine = window.app_handle().state::<TranscodingEngine>();
            let (enabled, timeout_seconds, processing_job_ids) =
                exit_auto_wait_snapshot(&engine);
            let processing_job_count = processing_job_ids.len();

            if !enabled || processing_job_count == 0 {
                return;
            }

            api.prevent_close();
            if !coordinator.try_mark_prompt_emitted() {
                return;
            }

            let payload = ExitRequestPayload {
                processing_job_count,
                timeout_seconds,
            };
            if let Err(err) = window.emit("app://exit-requested", payload) {
                crate::debug_eprintln!("failed to emit app://exit-requested event: {err}");
            }
        })
        // Fallback: if the frontend never calls `window.show()` (e.g. crash during boot),
        // ensure the main window becomes visible after a short timeout so the app is not "dead".
        .setup(move |app| {
            #[cfg(desktop)]
            {
                if commands::updater::updater_is_configured(app.config()) {
                    app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                } else {
                    crate::debug_eprintln!(
                        "tauri-plugin-updater disabled: missing/placeholder updater pubkey or endpoints"
                    );
                }
            }

            if let Some(server) = focus_server.take() {
                server.spawn(app.handle().clone());
            }

            let _data_root = crate::ffui_core::init_data_root(app.handle())?;
            let engine = match TranscodingEngine::new() {
                Ok(engine) => engine,
                Err(err) => {
                    crate::debug_eprintln!("failed to initialize transcoding engine: {err:#}");
                    return Ok(());
                }
            };
            app.manage(engine);
            app.manage(app_exit::ExitCoordinator::default());

            #[cfg(windows)]
            {
                use windows::Win32::Foundation::HWND;
                use windows::Win32::UI::WindowsAndMessaging::{
                    CHANGEFILTERSTRUCT,
                    ChangeWindowMessageFilterEx,
                    MSGFLT_ALLOW,
                    MSGFLTINFO_STATUS,
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
	                            CHANGEFILTERSTRUCT {
	                                cbSize: u32::try_from(std::mem::size_of::<CHANGEFILTERSTRUCT>())
	                                    .expect("CHANGEFILTERSTRUCT size fits in u32"),
	                                ExtStatus: MSGFLTINFO_STATUS::default(),
	                            };

                        let hwnd = HWND(hwnd.0);
                        let messages: [u32; 3] = [WM_DROPFILES, WM_COPYDATA, 0x0049];

	                        for msg in messages {
		                            filter.cbSize = u32::try_from(std::mem::size_of::<CHANGEFILTERSTRUCT>())
		                                .expect("CHANGEFILTERSTRUCT size fits in u32");
		                            filter.ExtStatus = MSGFLTINFO_STATUS::default();
		                            drop(ChangeWindowMessageFilterEx(hwnd, msg, WINDOW_MESSAGE_FILTER_ACTION(MSGFLT_ALLOW.0), Some(&raw mut filter)));
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
                    if let Err(err) = event_handle.emit("auto-compress://progress", progress) {
                        crate::debug_eprintln!("failed to emit auto-compress progress event: {err}");
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
	                thread::park_timeout(Duration::from_secs(10));
	                if let Some(window) = handle.get_webview_window("main") {
	                    drop(window.show());
	                }
	            });
	            Ok(())
	        })
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(err) => {
            crate::debug_eprintln!("error while building tauri application: {err:#}");
            return;
        }
    };

    app.run(|app, event| {
        let tauri::RunEvent::ExitRequested { api, .. } = event else {
            return;
        };

        let coordinator = app.state::<app_exit::ExitCoordinator>();
        if coordinator.consume_exit_allowance() {
            return;
        }

        let engine = app.state::<TranscodingEngine>();
        let (enabled, timeout_seconds, processing_job_ids) = exit_auto_wait_snapshot(&engine);
        let processing_job_count = processing_job_ids.len();

        if !enabled || processing_job_count == 0 {
            if enabled {
                // Persist resumable queue state on graceful exits so paused/waiting jobs
                // remain recoverable after restart, even when crash-recovery is disabled.
                let _ = engine.force_persist_queue_state_lite_now();
            }
            crate::ffui_core::write_shutdown_marker(crate::ffui_core::ShutdownMarkerKind::Clean);
            return;
        }

        if !coordinator.try_mark_system_exit_in_progress() {
            api.prevent_exit();
            return;
        }

        api.prevent_exit();

        let handle = app.clone();
        let marker_job_ids = processing_job_ids;
        tauri::async_runtime::spawn(async move {
            let engine = handle.state::<TranscodingEngine>().inner().clone();
            let outcome = tauri::async_runtime::spawn_blocking(move || {
                let result =
                    crate::app_exit::pause_processing_jobs_for_exit(&engine, timeout_seconds);
                if result.timed_out_job_count > 0 {
                    crate::debug_eprintln!(
                        "shutdown: auto-wait timed out for {} job(s) after {}s",
                        result.timed_out_job_count,
                        result.timeout_seconds
                    );
                }
            })
            .await;
            if let Err(err) = outcome {
                crate::debug_eprintln!("shutdown: auto-wait join failed: {err}");
            }

            crate::ffui_core::write_shutdown_marker_with_auto_wait_job_ids(
                crate::ffui_core::ShutdownMarkerKind::CleanAutoWait,
                Some(marker_job_ids),
            );
            let coordinator = handle.state::<app_exit::ExitCoordinator>();
            coordinator.allow_exit();
            handle.exit(0);
        });
    });
}

#[cfg(test)]
mod lib_tests;
