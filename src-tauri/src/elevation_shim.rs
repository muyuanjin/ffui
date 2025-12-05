//! Windows 权限降级 shim 模块
//!
//! 该模块实现了一个权限降级机制，用于在应用以管理员权限启动时，
//! 自动拉起一个继承 Explorer token 的普通权限 UI 进程。
//!
//! # 背景
//!
//! Windows 系统对拖放操作的安全限制：
//! - 从非管理员权限进程拖入的文件可以被管理员权限进程接收
//! - 从管理员权限进程无法接收非管理员权限的拖放事件
//!
//! # 解决方案
//!
//! 当应用以管理员权限运行时，此模块会：
//! 1. 检测当前进程是否具有管理员权限
//! 2. 获取 Explorer 进程句柄（作为"父进程"来源）
//! 3. 使用 PROC_THREAD_ATTRIBUTE_PARENT_PROCESS 创建子进程，继承 Explorer 的 token
//! 4. 设置 FFUI_SKIP_ELEVATION_SHIM 环境变量避免子进程递归重启
//! 5. 退出管理员权限进程，用普通权限进程接收拖放事件

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
    /// 目标可执行文件被系统标记为"需要管理员权限"，无法用普通 token 启动。
    ElevationRequired,
    /// 其他任何错误，包装成 anyhow::Error 便于日志输出。
    Other(anyhow::Error),
}

#[allow(dead_code)]
/// 检查是否应跳过权限降级 shim。
///
/// 通过检查 `FFUI_SKIP_ELEVATION_SHIM` 环境变量来判断。
/// 当该变量被设置时返回 true，表示不应执行 shim 逻辑。
pub fn should_skip_shim() -> bool {
    std::env::var_os(SKIP_FLAG_ENV).is_some()
}

#[allow(dead_code)]
/// 为子进程标记跳过权限降级 shim。
///
/// 设置 `FFUI_SKIP_ELEVATION_SHIM` 环境变量，使得此后创建的子进程
/// 都会继承该变量，从而避免递归重启。
pub fn mark_skip_for_children() {
    // Newer Rust toolchains may treat environment mutation APIs as unsafe
    // operations; wrap them explicitly so tests compile under both models.
    unsafe {
        std::env::set_var(SKIP_FLAG_ENV, "1");
    }
}

#[allow(dead_code)]
/// 检查当前进程是否具有管理员权限。
///
/// # Returns
///
/// - `true` 如果当前进程以管理员权限运行
/// - `false` 如果权限检查失败或进程无管理员权限
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
/// 如果需要，尝试以普通权限重新启动应用。
///
/// 如果当前进程以管理员权限运行且未设置跳过标记，此函数会：
/// 1. 获取 Explorer 进程作为父进程
/// 2. 使用其 token 创建一个普通权限的子进程副本
/// 3. 退出当前管理员权限进程
///
/// # Returns
///
/// - `true` 如果成功拉起了普通权限进程（调用方进程应退出）
/// - `false` 如果不需要降权或降权失败（调用方应继续运行）
///
/// # Behavior
///
/// 默认启用 shim：管理员权限启动时，优先尝试拉起一个"继承 Explorer token 的"
/// 普通权限 UI 实例，确保桌面拖拽始终走非管理员窗口。通过
/// FFUI_SKIP_ELEVATION_SHIM 环境变量避免子进程递归重启。
pub fn relaunch_unelevated_if_needed() -> bool {
    if should_skip_shim() || !is_process_elevated() {
        return false;
    }

    match spawn_unelevated_self() {
        Ok(()) => true,
        Err(ShimSpawnError::ElevationRequired) => {
            // 这里是 Windows 的硬约束：当前 exe 被标记为需要管理员权限，
            // 无法从普通 Explorer token 启动一个"降权"副本。
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
        // 1) 找到 shell 窗口（通常是 Explorer），用它作为"父进程"，从而继承一个非管理员 token。
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

        InitializeProcThreadAttributeList(attr_list, 1, 0, &mut attr_list_size).map_err(|e| {
            ShimSpawnError::Other(anyhow::anyhow!(
                "InitializeProcThreadAttributeList (2) failed: {e}"
            ))
        })?;

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
