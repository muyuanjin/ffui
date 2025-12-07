use std::fs::File;
use std::io::Read;
use std::process::Command;

use super::resolve::{
    custom_path_for, downloaded_tool_path, looks_like_bare_program_name, resolve_in_path,
    tool_binary_name,
};
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

// Quick PE sanity check to avoid asking Windows to execute obviously-invalid
// files named with an .exe extension (e.g. a leftover test stub). This prevents
// the OS loader from showing the "Unsupported 16-bit application" dialog when
// running `cargo test` on Windows.
#[cfg(windows)]
fn looks_like_pe_executable(path: &str) -> bool {
    let Ok(mut f) = File::open(path) else {
        return false;
    };
    let mut mz: [u8; 2] = [0, 0];
    if f.read_exact(&mut mz).is_err() {
        return false;
    }
    mz == [b'M', b'Z']
}

#[cfg(not(windows))]
fn looks_like_pe_executable(_path: &str) -> bool {
    true
}

// 注意：不调用 Win32 的 SetErrorMode / SetThreadErrorMode，以减少对 windows crate
// 可选 feature 的依赖；通过前置 PE 头检查即可避免大多数系统弹窗。

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

pub(crate) fn verify_tool_binary(path: &str, kind: ExternalToolKind, source: &str) -> bool {
    let debug_log = std::env::var("FFUI_TEST_LOG").is_ok();
    // 避免在 Windows 上对明显不是 PE 可执行文件的 .exe 进行 spawn，
    // 例如测试遗留的占位文本文件，从而防止系统弹出“不支持的 16 位应用程序”。
    #[cfg(windows)]
    {
        if path.to_ascii_lowercase().ends_with(".exe") && !looks_like_pe_executable(path) {
            if debug_log {
                eprintln!(
                    "[verify_tool_binary] skip invalid .exe (no MZ header): {path} ({source})"
                );
            }
            return false;
        }
        // no-op: rely on PE 头检查避免触发系统弹窗
    }
    let mut cmd = Command::new(path);
    configure_background_command(&mut cmd);
    // For ffmpeg/ffprobe we prefer `-version`, which avoids the non-zero exit
    // code some builds use for `--version`. For avifenc we only care that the
    // binary can be spawned at all; many builds exit non‑zero when called
    // without real input, so we treat any successful spawn as "available".
    match kind {
        ExternalToolKind::Avifenc => {
            cmd.arg("--help");
            match cmd.output() {
                Ok(out) => {
                    if debug_log {
                        eprintln!(
                            "[verify_tool_binary] kind=avifenc path={} source={} status={} stdout_len={} stderr_len={}",
                            path,
                            source,
                            out.status,
                            out.stdout.len(),
                            out.stderr.len()
                        );
                    }
                    true
                }
                Err(err) => {
                    if debug_log {
                        eprintln!(
                            "[verify_tool_binary] kind=avifenc path={} source={} error_kind={:?} os_error={:?}",
                            path,
                            source,
                            err.kind(),
                            err.raw_os_error()
                        );
                    }
                    if is_exec_arch_mismatch(&err) {
                        mark_arch_incompatible_for_session(kind, source, path, &err);
                    }
                    false
                }
            }
        }
        _ => {
            // Prefer `-version` which works for ffmpeg/ffprobe and avoids the
            // non-zero exit code some builds use for `--version`.
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
    }
}

pub(super) fn detect_local_tool_version(path: &str, _kind: ExternalToolKind) -> Option<String> {
    #[cfg(windows)]
    {
        if path.to_ascii_lowercase().ends_with(".exe") && !looks_like_pe_executable(path) {
            return None;
        }
        // no-op: rely on PE 头检查避免触发系统弹窗
    }
    let mut cmd = Command::new(path);
    configure_background_command(&mut cmd);
    cmd.arg("-version")
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
}

pub(super) fn should_mark_update_available(
    source: &str,
    local_version: Option<&str>,
    remote_version: Option<&str>,
) -> bool {
    let _ = source;
    match (local_version, remote_version) {
        (Some(local), Some(remote)) => !local.contains(remote),
        _ => false,
    }
}

pub fn tool_status(kind: ExternalToolKind, settings: &ExternalToolSettings) -> ExternalToolStatus {
    // For status reporting we prefer a robust, best-effort probe that only
    // reports a path as "ready" when we have actually confirmed that it can
    // be executed. This mirrors the candidate ordering used by
    // `ensure_tool_available` but deliberately never triggers auto-download
    // so that opening the Settings panel remains cheap and predictable.
    let runtime = snapshot_download_state(kind);

    let mut resolved_path: Option<String> = None;
    let mut source: Option<String> = None;
    let mut version: Option<String> = None;

    // Build candidates in the same priority order as ensure_tool_available:
    // custom > downloaded > PATH. We skip any candidate that is already
    // known to be architecturally incompatible in this session.
    let mut candidates: Vec<(String, String)> = Vec::new();

    if let Some(custom_raw) = custom_path_for(kind, settings) {
        let expanded = if looks_like_bare_program_name(&custom_raw) {
            resolve_in_path(&custom_raw)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or(custom_raw)
        } else {
            custom_raw
        };
        candidates.push((expanded, "custom".to_string()));
    }

    if runtime.download_arch_incompatible {
        // Skip the downloaded candidate for this session; PATH or custom
        // sources may still succeed.
    } else if let Some(downloaded) = downloaded_tool_path(kind) {
        candidates.push((
            downloaded.to_string_lossy().into_owned(),
            "download".to_string(),
        ));
    }

    let bin = tool_binary_name(kind).to_string();
    let path_candidate = resolve_in_path(&bin)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(bin);
    candidates.push((path_candidate, "path".to_string()));

    for (path, src) in candidates {
        if src == "path" && runtime.path_arch_incompatible {
            // We already know PATH is architecturally incompatible for this
            // tool in this session; surface this via last_download_error but
            // do not pretend the tool is ready.
            continue;
        }

        if verify_tool_binary(&path, kind, &src) {
            version = detect_local_tool_version(&path, kind);
            resolved_path = Some(path);
            source = Some(src);
            break;
        }
    }

    // 使用一个快速的、本地常量版本号来提供“是否有更新”的提示，避免在
    // Tauri 命令路径（尤其是应用启动后首次打开设置面板时）发起任何同步
    // 网络请求，从而堵塞 UI。
    let remote_version = match kind {
        ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe => {
            Some(FFMPEG_STATIC_VERSION.to_string())
        }
        ExternalToolKind::Avifenc => None,
    };

    let update_available = match (&source, &version, &remote_version) {
        (Some(source), version, remote) => {
            should_mark_update_available(source, version.as_deref(), remote.as_deref())
        }
        (None, _, _) => false,
    };

    ExternalToolStatus {
        kind,
        resolved_path,
        source,
        version,
        remote_version,
        update_available,
        auto_download_enabled: settings.auto_download,
        auto_update_enabled: settings.auto_update,
        // Map runtime state so the UI can render download-in-progress cards.
        download_in_progress: runtime.in_progress,
        download_progress: runtime.progress,
        downloaded_bytes: runtime.downloaded_bytes,
        total_bytes: runtime.total_bytes,
        bytes_per_second: runtime.bytes_per_second,
        last_download_error: runtime.last_error,
        last_download_message: runtime.last_message,
    }
}
