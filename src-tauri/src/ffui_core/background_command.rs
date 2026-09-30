//! Windows 后台子进程的创建标志。
//!
//! 常量不按平台裁剪：pin 住该决策的回归测试因此在 Linux/macOS 上也会执行。

/// `CREATE_NO_WINDOW`：子进程不创建控制台窗口。
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 后台 ffmpeg/ffprobe 等辅助进程使用的创建标志。
///
/// 这里不能加入 `DETACHED_PROCESS`（`0x0000_0008`）：它让子进程脱离调用方的控制台与管道继承，
/// 而所有调用点都通过管道读取 ffmpeg/ffprobe 输出。
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
