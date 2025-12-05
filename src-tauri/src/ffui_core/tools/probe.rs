use std::process::Command;

use super::runtime_state::{mark_arch_incompatible_for_session, snapshot_download_state};
use super::types::*;
use crate::ffui_core::settings::ExternalToolSettings;

// Ensure helper commands (version checks, probes, etc.) do not pop up visible
// console windows on Windows. On other platforms this is a no-op.
#[cfg(windows)]
pub(super) fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(super) fn configure_background_command(_cmd: &mut Command) {}

#[cfg(windows)]
pub(super) fn is_exec_arch_mismatch(err: &std::io::Error) -> bool {
    // ERROR_BAD_EXE_FORMAT. This is the typical signal for trying to run a
    // 32-bit binary on 64-bit Windows or another incompatible PE image.
    matches!(err.raw_os_error(), Some(193))
}

#[cfg(not(windows))]
pub(super) fn is_exec_arch_mismatch(err: &std::io::Error) -> bool {
    // On Unix-like systems, ENOEXEC (8) is raised when the OS loader cannot
    // execute the file as a program. This often indicates an incompatible or
    // corrupt binary. It is not a perfect architecture check but is a strong
    // signal that this tool will never run successfully.
    matches!(err.raw_os_error(), Some(8))
}

pub(super) fn verify_tool_binary(path: &str, kind: ExternalToolKind, source: &str) -> bool {
    let debug_log = std::env::var("FFUI_TEST_LOG").is_ok();
    // Prefer `-version` which works for ffmpeg/ffprobe and avoids the
    // non-zero exit code some builds use for `--version`.
    let mut cmd = Command::new(path);
    configure_background_command(&mut cmd);
    cmd.arg("-version");

    match cmd.output() {
        Ok(out) => {
            if debug_log {
                eprintln!(
                    "[verify_tool_binary] path={} source={} status={} stdout_len={} stderr_len={}",
                    path,
                    source,
                    out.status,
                    out.stdout.len(),
                    out.stderr.len()
                );
            }
            out.status.success()
        }
        Err(err) => {
            if debug_log {
                eprintln!(
                    "[verify_tool_binary] path={} source={} error_kind={:?} os_error={:?}",
                    path,
                    source,
                    err.kind(),
                    err.raw_os_error()
                );
            }
            if is_exec_arch_mismatch(&err) {
                // Treat this as an architecture incompatibility and remember it
                // for the rest of the session so we do not keep trying to run
                // a broken binary.
                mark_arch_incompatible_for_session(kind, source, path, &err);
            }
            false
        }
    }
}

pub(super) fn detect_local_tool_version(path: &str, _kind: ExternalToolKind) -> Option<String> {
    let mut cmd = Command::new(path);
    configure_background_command(&mut cmd);
    cmd.arg("-version")
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
}

pub(super) fn should_mark_update_available(
    auto_update_enabled: bool,
    source: &str,
    local_version: Option<&str>,
    remote_version: Option<&str>,
) -> bool {
    if !auto_update_enabled || source != "path" {
        return false;
    }
    match (local_version, remote_version) {
        (Some(local), Some(remote)) => !local.contains(remote),
        _ => false,
    }
}

pub fn tool_status(kind: ExternalToolKind, settings: &ExternalToolSettings) -> ExternalToolStatus {
    use super::download::latest_remote_version;
    use super::resolve::resolve_tool_path;

    let auto_download_enabled = settings.auto_download;
    let auto_update_enabled = settings.auto_update;

    // For status reporting we prefer a lightweight, best-effort probe:
    // resolve the path and, if possible, grab a version line in a single process
    // spawn. This avoids double-spawning the tool just to confirm availability.
    let (resolved_path, source, version, update_available) = match resolve_tool_path(kind, settings)
    {
        Ok((path, source)) => {
            let version = detect_local_tool_version(&path, kind);
            let remote = if auto_update_enabled {
                latest_remote_version(kind)
            } else {
                None
            };
            let update_available = should_mark_update_available(
                auto_update_enabled,
                &source,
                version.as_deref(),
                remote.as_deref(),
            );
            (Some(path), Some(source), version, update_available)
        }
        Err(_) => (None, None, None, false),
    };

    let runtime = snapshot_download_state(kind);

    ExternalToolStatus {
        kind,
        resolved_path,
        source,
        version,
        update_available,
        auto_download_enabled,
        auto_update_enabled,
        // Map runtime state so the UI can render download-in-progress cards.
        download_in_progress: runtime.in_progress,
        download_progress: runtime.progress,
        last_download_error: runtime.last_error,
        last_download_message: runtime.last_message,
    }
}
