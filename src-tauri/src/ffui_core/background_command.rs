//! Windows 后台子进程的创建标志。
//!
//! 常量不按平台裁剪：pin 住该决策的回归测试因此在 Linux/macOS 上也会执行。

/// `CREATE_NO_WINDOW`：子进程不创建控制台窗口。
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 后台 ffmpeg/ffprobe 等辅助进程使用的创建标志。
///
/// 这里不能加入 `DETACHED_PROCESS`（`0x0000_0008`）：它与 `CREATE_NO_WINDOW` 同时给出时，被 Win32 忽略的是
/// `CREATE_NO_WINDOW`（MSDN CreateProcess 的 dwCreationFlags），于是子进程真的会脱离调用方控制台与继承句柄，
/// 而调用方（探测、预览、批量压缩、外部工具探针）都在等待子进程结束并读取结果，没有任何调用点需要脱离调用方会话。
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) const BACKGROUND_CREATION_FLAGS: u32 = CREATE_NO_WINDOW;

#[cfg(test)]
mod tests {
    use super::{BACKGROUND_CREATION_FLAGS, CREATE_NO_WINDOW};

    #[test]
    fn background_commands_never_detach_from_the_parent() {
        const DETACHED_PROCESS: u32 = 0x0000_0008;

        assert_eq!(BACKGROUND_CREATION_FLAGS, CREATE_NO_WINDOW);
        assert_eq!(BACKGROUND_CREATION_FLAGS & DETACHED_PROCESS, 0);
    }
}
