use std::process::Command;

/// Configure background commands to avoid flashing console windows on Windows.
#[cfg(windows)]
pub(crate) fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(crate::ffui_core::background_command::BACKGROUND_CREATION_FLAGS);
}

#[cfg(not(windows))]
pub(crate) fn configure_background_command(_cmd: &mut Command) {}
