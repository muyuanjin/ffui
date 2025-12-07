mod commands;
mod ffui_core;
mod system_metrics;
mod taskbar_progress;

use std::{thread, time::Duration};

use tauri::{Emitter, Manager};

use crate::ffui_core::{AutoCompressProgress, QueueState, TranscodingEngine};
use crate::system_metrics::{MetricsState, spawn_metrics_sampler};
use crate::taskbar_progress::update_taskbar_progress;

// Windows-only: detection +重启逻辑，用于把管理员进程“降权”为普通 UI 进程，
// 这样最终显示出来的窗口始终是非管理员的，可以正常接收 Explorer 的拖拽。
#[cfg(windows)]
mod elevation_shim {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};

    use windows::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, HWND};
    use windows::Win32::Security::{
        GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation,
    };
    use windows::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT,
        GetCurrentProcess, InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST,
        OpenProcess, OpenProcessToken, PROC_THREAD_ATTRIBUTE_PARENT_PROCESS,
        PROCESS_CREATE_PROCESS, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOEXW,
        UpdateProcThreadAttribute,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetShellWindow, GetWindowThreadProcessId};
    use windows::core::{Error as WinError, PCWSTR, PWSTR};

    #[allow(dead_code)]
    const SKIP_FLAG_ENV: &str = "FFUI_SKIP_ELEVATION_SHIM";

    #[allow(dead_code)]
    /// 代表降权重启过程中可能出现的错误。
    enum ShimSpawnError {
        /// 目标可执行文件被系统标记为“需要管理员权限”，无法用普通 token 启动。
        ElevationRequired,
        /// 其他任何错误，包装成 anyhow::Error 便于日志输出。
        Other(anyhow::Error),
    }

    #[allow(dead_code)]
    pub fn should_skip_shim() -> bool {
        std::env::var_os(SKIP_FLAG_ENV).is_some()
    }

    #[allow(dead_code)]
    pub fn mark_skip_for_children() {
        // Newer Rust toolchains may treat environment mutation APIs as unsafe
        // operations; wrap them explicitly so tests compile under both models.
        unsafe {
            std::env::set_var(SKIP_FLAG_ENV, "1");
        }
    }

    #[allow(dead_code)]
    pub fn is_process_elevated() -> bool {
        unsafe {
            let mut token: HANDLE = HANDLE::default();
            let current_process = GetCurrentProcess();
            if OpenProcessToken(current_process, TOKEN_QUERY, &mut token).is_err() {
                return false;
            }

            let mut elevation: TOKEN_ELEVATION = zeroed();
            let mut size: u32 = size_of::<TOKEN_ELEVATION>() as u32;
            if GetTokenInformation(
                token,
                TokenElevation,
                Some(&mut elevation as *mut _ as *mut c_void),
                size,
                &mut size,
            )
            .is_err()
            {
                let _ = CloseHandle(token);
                return false;
            }

            let _ = CloseHandle(token);
            elevation.TokenIsElevated != 0
        }
    }

    #[allow(dead_code)]
    pub fn relaunch_unelevated_if_needed() -> bool {
        // 默认启用 shim：管理员权限启动时，优先尝试拉起一个“继承 Explorer token 的”
        // 普通权限 UI 实例，确保桌面拖拽始终走非管理员窗口。通过
        // FFUI_SKIP_ELEVATION_SHIM 环境变量避免子进程递归重启。
        if should_skip_shim() || !is_process_elevated() {
            return false;
        }

        match spawn_unelevated_self() {
            Ok(()) => true,
            Err(ShimSpawnError::ElevationRequired) => {
                // 这里是 Windows 的硬约束：当前 exe 被标记为需要管理员权限，
                // 无法从普通 Explorer token 启动一个“降权”副本。
                eprintln!(
                    "failed to spawn unelevated UI process: \
CreateProcessW failed with ERROR_ELEVATION_REQUIRED (0x800702E4); \
当前可执行文件被系统标记为需要管理员权限，无法自动拉起非管理员窗口。\
请以普通权限运行应用以启用桌面拖拽，或者在环境中设置 FFUI_SKIP_ELEVATION_SHIM=1 来关闭降权逻辑。"
                );
                false
            }
            Err(ShimSpawnError::Other(err)) => {
                eprintln!("failed to spawn unelevated UI process: {err}");
                false
            }
        }
    }

    #[allow(dead_code)]
    fn spawn_unelevated_self() -> Result<(), ShimSpawnError> {
        unsafe {
            // 1) 找到 shell 窗口（通常是 Explorer），用它作为“父进程”，从而继承一个非管理员 token。
            let shell_hwnd: HWND = GetShellWindow();
            if shell_hwnd.0.is_null() {
                return Err(ShimSpawnError::Other(anyhow::anyhow!(
                    "GetShellWindow returned null (code={:?})",
                    GetLastError()
                )));
            }

            let mut shell_pid: u32 = 0;
            GetWindowThreadProcessId(shell_hwnd, Some(&mut shell_pid));
            if shell_pid == 0 {
                return Err(ShimSpawnError::Other(anyhow::anyhow!(
                    "GetWindowThreadProcessId returned pid=0"
                )));
            }

            let shell_process: HANDLE = OpenProcess(PROCESS_CREATE_PROCESS, false, shell_pid)
                .map_err(|e| {
                    ShimSpawnError::Other(anyhow::anyhow!(
                        "OpenProcess(PROCESS_CREATE_PROCESS) failed: {e}"
                    ))
                })?;

            // 2) 准备 PROC_THREAD_ATTRIBUTE_LIST，把 Explorer 进程句柄塞进去。
            let mut attr_list_size: usize = 0;
            let _ = InitializeProcThreadAttributeList(
                LPPROC_THREAD_ATTRIBUTE_LIST::default(),
                1,
                0,
                &mut attr_list_size,
            );

            let mut attr_buf: Vec<u8> = vec![0u8; attr_list_size];
            let attr_list = LPPROC_THREAD_ATTRIBUTE_LIST(attr_buf.as_mut_ptr() as *mut c_void);

            InitializeProcThreadAttributeList(attr_list, 1, 0, &mut attr_list_size).map_err(
                |e| {
                    ShimSpawnError::Other(anyhow::anyhow!(
                        "InitializeProcThreadAttributeList (2) failed: {e}"
                    ))
                },
            )?;

            UpdateProcThreadAttribute(
                attr_list,
                0,
                PROC_THREAD_ATTRIBUTE_PARENT_PROCESS as usize,
                Some(&shell_process as *const _ as *const c_void),
                size_of::<HANDLE>(),
                None,
                None,
            )
            .map_err(|e| {
                ShimSpawnError::Other(anyhow::anyhow!("UpdateProcThreadAttribute failed: {e}"))
            })?;

            // 3) 组装命令行："当前 exe" + 一个标记参数，避免子进程再次进入 shim。
            let exe_path =
                std::env::current_exe().map_err(|e| ShimSpawnError::Other(anyhow::anyhow!(e)))?;
            let exe_str = exe_path.as_os_str().to_string_lossy().into_owned();

            let cmdline = format!("\"{exe_str}\" --from-elevated");
            let mut cmdline_w: Vec<u16> =
                cmdline.encode_utf16().chain(std::iter::once(0)).collect();
            let exe_w: Vec<u16> = exe_str.encode_utf16().chain(std::iter::once(0)).collect();

            let mut si: STARTUPINFOEXW = zeroed();
            si.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            si.lpAttributeList = attr_list;

            let mut pi: PROCESS_INFORMATION = zeroed();

            // 标记当前进程的环境，这样后续创建的子进程（包括下面这个）都会继承
            // `FFUI_SKIP_ELEVATION_SHIM`，从而避免子进程再次进到 shim 里递归重启。
            mark_skip_for_children();

            let create_result: Result<(), WinError> = CreateProcessW(
                PCWSTR(exe_w.as_ptr()),
                PWSTR(cmdline_w.as_mut_ptr()),
                None,
                None,
                false,
                PROCESS_CREATION_FLAGS(EXTENDED_STARTUPINFO_PRESENT.0),
                None,
                PCWSTR::null(),
                &si.StartupInfo,
                &mut pi,
            );

            if let Err(e) = create_result {
                let code = e.code().0 as u32;
                // 0x800702E4 == HRESULT_FROM_WIN32(ERROR_ELEVATION_REQUIRED)
                if code == 0x8007_02E4 {
                    return Err(ShimSpawnError::ElevationRequired);
                }
                return Err(ShimSpawnError::Other(anyhow::anyhow!(
                    "CreateProcessW failed: {e}"
                )));
            }

            DeleteProcThreadAttributeList(attr_list);
            let _ = CloseHandle(shell_process);
            let _ = CloseHandle(pi.hProcess);
            let _ = CloseHandle(pi.hThread);
        }

        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn mark_skip_for_children_sets_and_detects_flag() {
            // 确保起始环境里没有跳过标记。
            unsafe {
                std::env::remove_var(SKIP_FLAG_ENV);
            }
            assert!(!should_skip_shim());

            // 调用 mark_skip_for_children 后，should_skip_shim 必须返回 true。
            mark_skip_for_children();
            assert!(should_skip_shim());

            // 清理环境，避免污染其他测试。
            unsafe {
                std::env::remove_var(SKIP_FLAG_ENV);
            }
        }
    }
}

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

    let engine = TranscodingEngine::new().expect("failed to initialize transcoding engine");
    let metrics_state = MetricsState::default();

    tauri::Builder::default()
        .manage(engine)
        .manage(metrics_state.clone())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::queue::get_queue_state,
            commands::queue::enqueue_transcode_job,
            commands::queue::cancel_transcode_job,
            commands::queue::wait_transcode_job,
            commands::queue::resume_transcode_job,
            commands::queue::restart_transcode_job,
            commands::queue::reorder_queue,
            commands::presets::get_presets,
            commands::presets::save_preset,
            commands::presets::delete_preset,
            commands::settings::get_app_settings,
            commands::settings::save_app_settings,
            commands::settings::get_smart_scan_defaults,
            commands::settings::save_smart_scan_defaults,
            commands::settings::run_auto_compress,
            commands::tools::get_cpu_usage,
            commands::tools::get_gpu_usage,
            commands::tools::get_external_tool_statuses,
            commands::tools::download_external_tool_now,
            commands::tools::open_devtools,
            commands::tools::ack_taskbar_progress,
            commands::tools::inspect_media,
            commands::tools::get_preview_data_url,
            commands::tools::select_playable_media_path,
            commands::tools::metrics_subscribe,
            commands::tools::metrics_unsubscribe,
            commands::tools::get_metrics_history
        ])
        // Fallback: if the frontend never calls `window.show()` (e.g. crash during boot),
        // ensure the main window becomes visible after a short timeout so the app is not "dead".
        .setup(move |app| {
            #[cfg(windows)]
            {
                use windows::Win32::Foundation::HWND;
                use windows::Win32::UI::WindowsAndMessaging::{
                    CHANGEFILTERSTRUCT, ChangeWindowMessageFilterEx, MSGFLT_ALLOW,
                    WINDOW_MESSAGE_FILTER_ACTION, WM_COPYDATA, WM_DROPFILES,
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
                        let mut filter: CHANGEFILTERSTRUCT = CHANGEFILTERSTRUCT {
                            cbSize: std::mem::size_of::<CHANGEFILTERSTRUCT>() as u32,
                            ExtStatus: Default::default(),
                        };

                        let hwnd = HWND(hwnd.0);
                        let messages: [u32; 3] = [WM_DROPFILES, WM_COPYDATA, 0x0049];

                        for msg in messages {
                            filter.cbSize = std::mem::size_of::<CHANGEFILTERSTRUCT>() as u32;
                            filter.ExtStatus = Default::default();
                            let _ = ChangeWindowMessageFilterEx(
                                hwnd,
                                msg,
                                WINDOW_MESSAGE_FILTER_ACTION(MSGFLT_ALLOW.0),
                                Some(&mut filter),
                            );
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
            // 避免在 Tauri setup 阶段做同步网络请求（latest_remote_version →
            // GitHub API），否则在网络不通/延迟很高时会阻塞应用启动，看起来像
            // “程序卡死”。初始快照仍按需由前端通过 get_external_tool_statuses
            // 命令拉取，再由 tools::update_latest_status_snapshot 进行缓存。
            {
                crate::ffui_core::tools::set_tool_event_app_handle(app.handle().clone());
            }

            // Stream queue state changes from the Rust engine to the frontend via
            // a long-lived Tauri event so the UI does not need to poll.
            {
                let event_handle = handle.clone();
                let taskbar_handle = handle.clone();
                let engine = handle.state::<TranscodingEngine>();
                engine.register_queue_listener(move |state: QueueState| {
                    if let Err(err) = event_handle.emit("ffui://queue-state", state.clone()) {
                        eprintln!("failed to emit queue-state event: {err}");
                    }

                    // Update the Windows taskbar progress bar (no-op on
                    // non-Windows platforms) based on the aggregated queue
                    // progress for this snapshot.
                    #[cfg(windows)]
                    {
                        let engine = taskbar_handle.state::<TranscodingEngine>();
                        let settings = engine.settings();
                        update_taskbar_progress(
                            &taskbar_handle,
                            &state,
                            settings.taskbar_progress_mode,
                        );
                    }
                });
            }

            // Stream Smart Scan progress snapshots so the frontend can show
            // coarse-grained scanning progress for large directory trees.
            {
                let engine = app.state::<TranscodingEngine>();
                let event_handle = handle.clone();
                engine.register_smart_scan_listener(move |progress: AutoCompressProgress| {
                    if let Err(err) =
                        event_handle.emit("auto-compress://progress", progress.clone())
                    {
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
    use crate::commands::tools::{get_preview_data_url, select_playable_media_path};

    #[test]
    fn get_preview_data_url_builds_data_url_prefix() {
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        // Write a small dummy JPEG-like payload into the temp directory and
        // ensure the helper returns a data URL with the expected prefix.
        let tmp_dir = std::env::temp_dir();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let path = tmp_dir.join(format!("ffui_test_preview_{timestamp}.jpg"));

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
        use std::time::{SystemTime, UNIX_EPOCH};

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
}
