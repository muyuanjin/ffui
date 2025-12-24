use std::collections::HashMap;
use std::fs;
#[cfg(windows)]
use std::fs::File;
#[cfg(windows)]
use std::io::{
    Read,
    Seek,
    SeekFrom,
};
use std::process::Command;
use std::time::{
    Duration,
    SystemTime,
};

use super::runtime_state::mark_arch_incompatible_for_session;
use super::types::*;

// Avoid visible console windows for helper commands on Windows.
#[cfg(windows)]
pub(super) fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(super) fn configure_background_command(_cmd: &mut Command) {}

// Quick PE sanity check to avoid executing obviously-invalid .exe files on Windows.
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

// 说明：通过前置 PE 头检查避免大多数系统弹窗，无需额外 Win32 调用。

#[cfg(windows)]
pub(super) fn is_exec_arch_mismatch(err: &std::io::Error) -> bool {
    // ERROR_BAD_EXE_FORMAT: 典型的 PE 架构不兼容信号。
    matches!(err.raw_os_error(), Some(193))
}

#[cfg(not(windows))]
pub(super) fn is_exec_arch_mismatch(err: &std::io::Error) -> bool {
    // 在类 Unix 系统上，ENOEXEC(8) 常用于指示不可执行的二进制。
    matches!(err.raw_os_error(), Some(8))
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileFingerprint {
    len: u64,
    modified_millis: Option<u64>,
}

fn file_fingerprint(path: &str) -> Option<FileFingerprint> {
    let meta = fs::metadata(path).ok()?;
    let len = meta.len();
    let modified_millis = meta.modified().ok().and_then(|t| {
        t.duration_since(SystemTime::UNIX_EPOCH)
            .ok()
            .and_then(|d| d.as_millis().try_into().ok())
    });
    Some(FileFingerprint {
        len,
        modified_millis,
    })
}

#[derive(Clone, Debug)]
struct VerifyCacheEntry {
    ok: bool,
    version: Option<String>,
    fingerprint: Option<FileFingerprint>,
    last_checked: std::time::Instant,
}

static VERIFY_CACHE: once_cell::sync::Lazy<
    std::sync::Mutex<HashMap<(ExternalToolKind, String), VerifyCacheEntry>>,
> = once_cell::sync::Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

#[derive(Clone, Debug)]
pub(crate) struct PersistableProbeCacheEntry {
    pub ok: bool,
    pub version: Option<String>,
    pub fingerprint_len: u64,
    pub fingerprint_modified_millis: Option<u64>,
}

pub(crate) fn cached_probe_entry_for_persistence(
    kind: ExternalToolKind,
    path: &str,
) -> Option<PersistableProbeCacheEntry> {
    let key = (kind, path.to_string());
    let map = VERIFY_CACHE.lock().ok()?;
    let entry = map.get(&key)?;
    let fp = entry.fingerprint.as_ref()?;
    Some(PersistableProbeCacheEntry {
        ok: entry.ok,
        version: entry.version.clone(),
        fingerprint_len: fp.len,
        fingerprint_modified_millis: fp.modified_millis,
    })
}

pub(crate) fn seed_probe_cache_from_persisted(
    kind: ExternalToolKind,
    path: String,
    ok: bool,
    version: Option<String>,
    fingerprint_len: u64,
    fingerprint_modified_millis: Option<u64>,
) {
    let key = (kind, path);
    let entry = VerifyCacheEntry {
        ok,
        version,
        fingerprint: Some(FileFingerprint {
            len: fingerprint_len,
            modified_millis: fingerprint_modified_millis,
        }),
        last_checked: std::time::Instant::now(),
    };
    if let Ok(mut map) = VERIFY_CACHE.lock() {
        map.insert(key, entry);
    }
}

#[cfg(test)]
pub(crate) fn reset_probe_cache_for_tests() {
    if let Ok(mut map) = VERIFY_CACHE.lock() {
        map.clear();
    }
}

fn cache_lookup(kind: ExternalToolKind, path: &str) -> Option<VerifyCacheEntry> {
    let key = (kind, path.to_string());
    let fp_now = file_fingerprint(path);
    let map = VERIFY_CACHE.lock().ok()?;
    if let Some(entry) = map.get(&key) {
        // If we have a stable fingerprint and it hasn't changed, reuse cached result.
        if entry.fingerprint.is_some() && entry.fingerprint == fp_now {
            return Some(entry.clone());
        }
        // If we have no fingerprint (e.g. bare program name), reuse results briefly
        // to avoid redundant spawns within the same refresh task.
        if entry.fingerprint.is_none() && entry.last_checked.elapsed() < Duration::from_secs(2) {
            return Some(entry.clone());
        }
    }
    None
}

fn cache_store_with_version(kind: ExternalToolKind, path: &str, ok: bool, version: Option<String>) {
    let key = (kind, path.to_string());
    let fp = file_fingerprint(path);
    let entry = VerifyCacheEntry {
        ok,
        version,
        fingerprint: fp,
        last_checked: std::time::Instant::now(),
    };
    if let Ok(mut map) = VERIFY_CACHE.lock() {
        map.insert(key, entry);
    }
}

fn extract_ffmpeg_version_line(stdout: &[u8]) -> Option<String> {
    let s = String::from_utf8_lossy(stdout);
    s.lines().next().map(|l| l.trim().to_string())
}

fn extract_first_non_empty_line(stdout: &[u8], stderr: &[u8]) -> Option<String> {
    let stdout_s = String::from_utf8_lossy(stdout);
    if let Some(line) = stdout_s.lines().map(str::trim).find(|l| !l.is_empty()) {
        return Some(line.to_string());
    }
    let stderr_s = String::from_utf8_lossy(stderr);
    stderr_s
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(|l| l.to_string())
}

#[cfg(windows)]
fn current_windows_pe_machine() -> Option<u16> {
    // Map Rust target_arch to PE machine codes.
    // IMAGE_FILE_MACHINE_AMD64 = 0x8664; I386 = 0x014c; ARM64 = 0xAA64.
    #[cfg(target_arch = "x86_64")]
    {
        return Some(0x8664);
    }
    #[cfg(target_arch = "x86")]
    {
        return Some(0x014c);
    }
    #[cfg(target_arch = "aarch64")]
    {
        return Some(0xAA64);
    }
    #[allow(unreachable_code)]
    None
}

#[cfg(windows)]
fn parse_pe_machine(path: &str) -> Option<u16> {
    let mut f = File::open(path).ok()?;
    let mut mz: [u8; 2] = [0, 0];
    f.read_exact(&mut mz).ok()?;
    if mz != [b'M', b'Z'] {
        return None;
    }
    // e_lfanew at offset 0x3C
    f.seek(SeekFrom::Start(0x3C)).ok()?;
    let mut off_buf = [0u8; 4];
    f.read_exact(&mut off_buf).ok()?;
    let pe_off = u32::from_le_bytes(off_buf) as u64;
    // PE signature + Machine
    f.seek(SeekFrom::Start(pe_off)).ok()?;
    let mut sig = [0u8; 4];
    f.read_exact(&mut sig).ok()?;
    if sig != [b'P', b'E', 0, 0] {
        return None;
    }
    let mut machine_buf = [0u8; 2];
    f.read_exact(&mut machine_buf).ok()?;
    Some(u16::from_le_bytes(machine_buf))
}

#[cfg(windows)]
fn pe_arch_compatible_with_host(machine: u16) -> bool {
    match (current_windows_pe_machine(), machine) {
        (Some(0x8664), 0x8664) => true, // AMD64 host, AMD64 binary
        (Some(0x014c), 0x014c) => true, // x86 host, x86 binary
        (Some(0xAA64), 0xAA64) => true, // ARM64 host, ARM64 binary
        // 64-bit Windows cannot run 32-bit? It can via WoW64 for AMD64. We accept that.
        (Some(0x8664), 0x014c) => true, // AMD64 host can run I386 via WoW64
        _ => false,
    }
}

pub(crate) fn verify_tool_binary(path: &str, kind: ExternalToolKind, source: &str) -> bool {
    let debug_log = std::env::var("FFUI_TEST_LOG").is_ok();
    if let Some(entry) = cache_lookup(kind, path) {
        return entry.ok;
    }
    // 避免在 Windows 上对明显不是 PE 可执行文件的 .exe 进行 spawn，
    // 例如测试遗留的占位文本文件，从而防止系统弹出“不支持的 16 位应用程序”。
    #[cfg(windows)]
    {
        if path.to_ascii_lowercase().ends_with(".exe") && !looks_like_pe_executable(path) {
            if debug_log {
                crate::debug_eprintln!(
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
            #[cfg(windows)]
            {
                // Fast path on Windows: if PE architecture is compatible, treat as available
                // without spawning a process.
                if let Some(machine) = parse_pe_machine(path) {
                    let ok = pe_arch_compatible_with_host(machine);
                    if !ok {
                        let err = std::io::Error::from_raw_os_error(193);
                        mark_arch_incompatible_for_session(kind, source, path, &err);
                        cache_store_with_version(kind, path, false, None);
                        return false;
                    }
                    cache_store_with_version(kind, path, true, None);
                    if debug_log {
                        crate::debug_eprintln!(
                            "[verify_tool_binary] fast-ok avifenc (PE arch match) path={path} source={source} machine=0x{machine:04x}"
                        );
                    }
                    return true;
                }
            }
            cmd.arg("--version");
            match cmd.output() {
                Ok(out) => {
                    if debug_log {
                        crate::debug_eprintln!(
                            "[verify_tool_binary] kind=avifenc path={} source={} status={} stdout_len={} stderr_len={}",
                            path,
                            source,
                            out.status,
                            out.stdout.len(),
                            out.stderr.len()
                        );
                    }
                    let version = extract_first_non_empty_line(&out.stdout, &out.stderr);
                    cache_store_with_version(kind, path, true, version);
                    true
                }
                Err(err) => {
                    if debug_log {
                        crate::debug_eprintln!(
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
                    cache_store_with_version(kind, path, false, None);
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
                        crate::debug_eprintln!(
                            "[verify_tool_binary] path={} source={} status={} stdout_len={} stderr_len={}",
                            path,
                            source,
                            out.status,
                            out.stdout.len(),
                            out.stderr.len()
                        );
                    }
                    let ok = out.status.success();
                    let version = if ok {
                        extract_ffmpeg_version_line(&out.stdout)
                    } else {
                        None
                    };
                    cache_store_with_version(kind, path, ok, version);
                    ok
                }
                Err(err) => {
                    if debug_log {
                        crate::debug_eprintln!(
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
                    cache_store_with_version(kind, path, false, None);
                    false
                }
            }
        }
    }
}

pub(super) fn detect_local_tool_version(path: &str, kind: ExternalToolKind) -> Option<String> {
    if let Some(entry) = cache_lookup(kind, path)
        && entry.ok
        && let Some(version) = entry.version
    {
        return Some(version);
    }
    #[cfg(windows)]
    {
        if path.to_ascii_lowercase().ends_with(".exe") && !looks_like_pe_executable(path) {
            return None;
        }
        // no-op: rely on PE 头检查避免触发系统弹窗
    }
    let mut cmd = Command::new(path);
    configure_background_command(&mut cmd);
    let version = match kind {
        ExternalToolKind::Avifenc => {
            // avifenc uses GNU-style `--version` in upstream builds; some versions
            // may print to stderr or exit non-zero, so we accept any output.
            cmd.arg("--version")
                .output()
                .ok()
                .and_then(|out| extract_first_non_empty_line(&out.stdout, &out.stderr))
        }
        _ => cmd
            .arg("-version")
            .output()
            .ok()
            .and_then(|out| extract_ffmpeg_version_line(&out.stdout)),
    };
    if version.is_some() {
        cache_store_with_version(kind, path, true, version.clone());
    }
    version
}
