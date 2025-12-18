use std::path::Path;

use windows::Win32::Foundation::{
    BOOL,
    HWND,
    LPARAM,
};
use windows::Win32::System::Threading::{
    AttachThreadInput,
    OpenProcess,
    PROCESS_NAME_FORMAT,
    PROCESS_QUERY_LIMITED_INFORMATION,
    QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop,
    EnumWindows,
    GetForegroundWindow,
    GetWindowTextLengthW,
    GetWindowTextW,
    GetWindowThreadProcessId,
    HWND_NOTOPMOST,
    HWND_TOPMOST,
    IsIconic,
    IsWindowVisible,
    SW_RESTORE,
    SW_SHOW,
    SWP_NOMOVE,
    SWP_NOSIZE,
    SWP_SHOWWINDOW,
    SetForegroundWindow,
    SetWindowPos,
    ShowWindow,
    SwitchToThisWindow,
};

fn focus_hwnd_raw_best_effort(hwnd: HWND) -> bool {
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOW);
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = BringWindowToTop(hwnd);
        if SetForegroundWindow(hwnd).as_bool() {
            return true;
        }

        let fg_hwnd = GetForegroundWindow();
        if fg_hwnd != HWND(std::ptr::null_mut()) {
            let fg_thread = GetWindowThreadProcessId(fg_hwnd, None);
            let target_thread = GetWindowThreadProcessId(hwnd, None);
            if fg_thread != 0 && target_thread != 0 && fg_thread != target_thread {
                let _ = AttachThreadInput(fg_thread, target_thread, true);
                let _ = SetForegroundWindow(hwnd);
                let _ = AttachThreadInput(fg_thread, target_thread, false);
            }
        }

        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW;
        let _ = SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags);
        let _ = SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, flags);
        let _ = BringWindowToTop(hwnd);
        let _ = SetForegroundWindow(hwnd);
        SwitchToThisWindow(hwnd, true);
        GetForegroundWindow() == hwnd
    }
}

pub(super) fn focus_primary_window_by_exe_path_best_effort(exe_path: &Path) -> bool {
    let target_exe = normalize_windows_path_for_compare(&exe_path.to_string_lossy());
    unsafe {
        let mut state = FindWindowByExeState {
            target_exe,
            current_pid: std::process::id(),
            hwnd: HWND(std::ptr::null_mut()),
            hwnd_title_match: HWND(std::ptr::null_mut()),
        };
        let lparam = LPARAM((&mut state as *mut FindWindowByExeState) as isize);
        let _ = EnumWindows(Some(enum_windows_find_by_exe_path), lparam);
        let hwnd = if state.hwnd_title_match != HWND(std::ptr::null_mut()) {
            state.hwnd_title_match
        } else {
            state.hwnd
        };
        if hwnd != HWND(std::ptr::null_mut()) {
            return focus_hwnd_raw_best_effort(hwnd);
        }
        false
    }
}

struct FindWindowByExeState {
    target_exe: String,
    current_pid: u32,
    hwnd: HWND,
    hwnd_title_match: HWND,
}

unsafe extern "system" fn enum_windows_find_by_exe_path(hwnd: HWND, lparam: LPARAM) -> BOOL {
    unsafe {
        let state = &mut *(lparam.0 as *mut FindWindowByExeState);

        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        let mut wpid: u32 = 0;
        let _thread = GetWindowThreadProcessId(hwnd, Some(&mut wpid));
        if wpid == 0 || wpid == state.current_pid {
            return BOOL(1);
        }

        let Some(exe_path) = query_process_image_path(wpid) else {
            return BOOL(1);
        };
        let exe_path = normalize_windows_path_for_compare(&exe_path);
        if exe_path != state.target_exe {
            return BOOL(1);
        }

        if state.hwnd == HWND(std::ptr::null_mut()) {
            state.hwnd = hwnd;
        }

        let title_len = GetWindowTextLengthW(hwnd);
        if title_len > 0 {
            let mut buffer = vec![0u16; title_len as usize + 1];
            let copied = GetWindowTextW(hwnd, &mut buffer);
            if copied > 0 {
                let title = String::from_utf16_lossy(&buffer[..copied as usize]);
                if title.to_ascii_lowercase().contains("ffui") {
                    state.hwnd_title_match = hwnd;
                    return BOOL(0);
                }
            }
        }

        BOOL(1)
    }
}

fn normalize_windows_path_for_compare(value: &str) -> String {
    let mut normalized = value.replace('/', "\\").to_ascii_lowercase();
    if let Some(rest) = normalized.strip_prefix("\\\\?\\") {
        normalized = rest.to_string();
    }
    if let Some(rest) = normalized.strip_prefix("\\??\\") {
        normalized = rest.to_string();
    }
    normalized
}

fn query_process_image_path(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::{
        CloseHandle,
        ERROR_INSUFFICIENT_BUFFER,
        GetLastError,
        HANDLE,
    };

    unsafe {
        let process: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

        let mut buffer: Vec<u16> = vec![0; 260];
        loop {
            let mut size: u32 = buffer.len() as u32;
            let ok = QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_FORMAT(0),
                windows::core::PWSTR(buffer.as_mut_ptr()),
                &mut size,
            )
            .is_ok();
            if ok {
                buffer.truncate(size as usize);
                let path = String::from_utf16_lossy(&buffer);
                let _ = CloseHandle(process);
                return Some(path);
            }

            if GetLastError() == ERROR_INSUFFICIENT_BUFFER {
                buffer.resize(buffer.len().saturating_mul(2).max(512), 0);
                continue;
            }

            let _ = CloseHandle(process);
            return None;
        }
    }
}
