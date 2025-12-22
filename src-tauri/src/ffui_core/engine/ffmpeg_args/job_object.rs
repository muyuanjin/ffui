//! Windows Job Object 管理模块
//!
//! 使用 Windows Job Objects 确保当父进程（FFUI）被强制终止时，
//! 所有由它启动的 ffmpeg 子进程也会被自动终止。
//!
//! 原理：创建一个带有 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 标志的 Job Object，
//! 将所有子进程添加到这个 Job Object 中。当 Job Object 的最后一个句柄被关闭时
//! （即父进程退出时），Windows 会自动终止所有关联的子进程。

#[cfg(windows)]
use std::sync::Mutex;

#[cfg(windows)]
use once_cell::sync::Lazy;
#[cfg(windows)]
use windows::Win32::Foundation::CloseHandle;
#[cfg(windows)]
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject,
    CreateJobObjectW,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};
#[cfg(windows)]
use windows::Win32::System::Threading::{
    OpenProcess,
    PROCESS_ALL_ACCESS,
};

/// 包装 Job Object 句柄的原始指针，使其可以跨线程安全使用
///
/// Windows Job Object 句柄本身是线程安全的，可以从任何线程访问。
/// 这个包装类型允许我们在静态变量中存储句柄。
#[cfg(windows)]
struct JobHandle(isize);

#[cfg(windows)]
unsafe impl Send for JobHandle {}
#[cfg(windows)]
unsafe impl Sync for JobHandle {}

/// 全局 Job Object 句柄，用于管理所有 ffmpeg 子进程
#[cfg(windows)]
static CHILD_PROCESS_JOB: Lazy<Mutex<Option<JobHandle>>> = Lazy::new(|| Mutex::new(None));

/// 初始化全局 Job Object
///
/// 应在应用启动时调用一次。创建一个带有 KILL_ON_JOB_CLOSE 标志的 Job Object，
/// 这样当父进程退出时，所有添加到此 Job Object 的子进程都会被自动终止。
#[cfg(windows)]
pub fn init_child_process_job() -> bool {
    use std::mem::zeroed;

    unsafe {
        // 创建一个匿名 Job Object
        let job_handle = match CreateJobObjectW(None, None) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("创建 Job Object 失败: {e}");
                return false;
            }
        };

        if job_handle.is_invalid() {
            eprintln!("创建 Job Object 返回无效句柄");
            return false;
        }

        // 配置 Job Object：当 Job Object 关闭时终止所有关联进程
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let set_result = SetInformationJobObject(
            job_handle,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );

        if let Err(e) = set_result {
            eprintln!("设置 Job Object 信息失败: {e}");
            let _ = CloseHandle(job_handle);
            return false;
        }

        // 保存 Job Object 句柄（存储原始指针值）；如已存在旧句柄，先关闭避免泄漏。
        let mut guard = CHILD_PROCESS_JOB.lock().expect("job object mutex poisoned");
        if let Some(prev) = guard.take() {
            let prev_handle = windows::Win32::Foundation::HANDLE(prev.0 as *mut std::ffi::c_void);
            let _ = CloseHandle(prev_handle);
        }
        *guard = Some(JobHandle(job_handle.0 as isize));

        true
    }
}

/// 将子进程添加到全局 Job Object
///
/// 在 spawn 子进程后立即调用此函数，将子进程添加到 Job Object 中。
/// 这样当父进程退出时，子进程会被自动终止。
#[cfg(windows)]
pub fn assign_child_to_job(child_pid: u32) -> bool {
    use windows::Win32::Foundation::HANDLE;

    unsafe {
        let guard = CHILD_PROCESS_JOB.lock().expect("job object mutex poisoned");
        let job_ptr = match &*guard {
            Some(h) => h.0,
            None => {
                // Job Object 未初始化，跳过
                return false;
            }
        };
        let job_handle = HANDLE(job_ptr as *mut std::ffi::c_void);

        // 打开子进程句柄
        let process_handle = match OpenProcess(PROCESS_ALL_ACCESS, false, child_pid) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("打开子进程 {child_pid} 失败: {e}");
                return false;
            }
        };

        if process_handle.is_invalid() {
            eprintln!("打开子进程 {child_pid} 返回无效句柄");
            return false;
        }

        // 将子进程添加到 Job Object
        let assign_result = AssignProcessToJobObject(job_handle, process_handle);
        let _ = CloseHandle(process_handle);

        if let Err(e) = assign_result {
            // 错误码 5 (ERROR_ACCESS_DENIED) 通常表示进程已经属于另一个 Job Object
            // 这在某些情况下是正常的（例如从 IDE 启动时）
            let code = e.code().0 as u32;
            if code != 5 {
                eprintln!("将子进程 {child_pid} 添加到 Job Object 失败: {e}");
            }
            return false;
        }

        true
    }
}

/// 非 Windows 平台的空实现
#[cfg(not(windows))]
pub fn init_child_process_job() -> bool {
    true
}

/// 非 Windows 平台的空实现
#[cfg(not(windows))]
pub fn assign_child_to_job(_child_pid: u32) -> bool {
    true
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn test_init_child_process_job() {
        // 测试 Job Object 初始化
        let result = init_child_process_job();
        assert!(result, "Job Object 初始化应该成功");

        // 再次初始化应该也能成功（会覆盖之前的）
        let result2 = init_child_process_job();
        assert!(result2, "重复初始化 Job Object 应该成功");
    }

    #[test]
    fn test_assign_nonexistent_process() {
        // 确保 Job Object 已初始化
        init_child_process_job();

        // 尝试添加一个不存在的进程 ID
        let result = assign_child_to_job(999999999);
        assert!(!result, "添加不存在的进程应该失败");
    }
}
