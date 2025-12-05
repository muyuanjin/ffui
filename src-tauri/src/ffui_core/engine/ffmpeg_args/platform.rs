use std::process::Command;

/// Configure background commands to avoid flashing console windows on Windows.
#[cfg(windows)]
pub(crate) fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn configure_background_command(_cmd: &mut Command) {}
