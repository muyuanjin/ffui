use std::process::Command;

/// Configure background commands to avoid flashing console windows on Windows.
#[cfg(windows)]
pub(crate) fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
}

#[cfg(not(windows))]
pub(crate) fn configure_background_command(_cmd: &mut Command) {}
