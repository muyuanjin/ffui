use std::fs::{
    self,
    OpenOptions,
};
use std::io::Write;
#[cfg(not(windows))]
use std::io::{
    ErrorKind,
    Seek,
    SeekFrom,
};
#[cfg(not(windows))]
use std::net::UdpSocket;
use std::path::{
    Path,
    PathBuf,
};
use std::sync::OnceLock;
#[cfg(not(windows))]
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use anyhow::{
    Context,
    Result,
};
#[cfg(not(windows))]
use fs2::FileExt;
#[cfg(not(windows))]
use serde::{
    Deserialize,
    Serialize,
};
use tauri::AppHandle;
#[cfg(not(windows))]
use tauri::{
    Manager,
    UserAttentionType,
};

#[cfg(windows)]
mod windows_focus;

const FOCUS_LOG_PREFIX: &str = "ffui.single-instance";

#[cfg(not(windows))]
const LOCK_FILE_PREFIX: &str = "ffui";
#[cfg(not(windows))]
const FOCUS_MESSAGE: &[u8] = b"focus";
#[cfg(not(windows))]
const LOOPBACK_ADDR: &str = "127.0.0.1";

fn single_instance_debug_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| {
        std::env::args().any(|arg| arg == "--single-instance-debug" || arg == "--si-debug")
    })
}

fn log_single_instance(instance_key: &str, message: &str) {
    if !single_instance_debug_enabled() {
        return;
    }

    let mut path = std::env::temp_dir();
    path.push(format!("{FOCUS_LOG_PREFIX}.{instance_key}.log"));

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "[{now_ms}] pid={} {message}", std::process::id());
    }
}

#[derive(Debug)]
pub struct SingleInstanceGuard {
    #[cfg(windows)]
    _mutex: windows::Win32::Foundation::HANDLE,
    #[cfg(not(windows))]
    _lock_file: std::fs::File,
}

#[cfg(windows)]
impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        unsafe {
            use windows::Win32::Foundation::CloseHandle;
            let _ = CloseHandle(self._mutex);
        }
    }
}

#[derive(Debug)]
pub struct FocusServer {
    #[cfg(not(windows))]
    socket: UdpSocket,
}

#[cfg(not(windows))]
#[derive(Debug, Clone, Serialize, Deserialize)]
struct LockInfo {
    port: u16,
    pid: u32,
}

#[derive(Debug)]
pub struct PrimaryInstance {
    pub guard: SingleInstanceGuard,
    pub focus_server: Option<FocusServer>,
}

#[derive(Debug)]
pub enum EnsureOutcome {
    Primary(PrimaryInstance),
    Secondary,
}

pub fn ensure_single_instance_or_focus_existing() -> Result<EnsureOutcome> {
    let exe_path = current_exe_canonicalized();
    let instance_key = derive_instance_key(&exe_path);

    #[cfg(windows)]
    {
        ensure_single_instance_windows(&exe_path, &instance_key)
    }

    #[cfg(not(windows))]
    {
        let lock_path = lock_path_for_key(&instance_key);
        let info_path = info_path_for_key(&instance_key);

        log_single_instance(
            &instance_key,
            &format!(
                "startup exe={} lock={} info={}",
                exe_path.display(),
                lock_path.display(),
                info_path.display()
            ),
        );

        let lock_file = match OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
        {
            Ok(file) => file,
            Err(err) => {
                log_single_instance(
                    &instance_key,
                    &format!(
                        "open lock file failed kind={:?} raw_os_error={:?}",
                        err.kind(),
                        err.raw_os_error()
                    ),
                );
                return Err(err)
                    .with_context(|| format!("open lock file: {}", lock_path.display()));
            }
        };

        match lock_file.try_lock_exclusive() {
            Ok(()) => {
                let focus_server =
                    FocusServer::bind_loopback().context("bind loopback UDP focus socket")?;
                let port = focus_server.port()?;
                let mut info_file = OpenOptions::new()
                    .read(true)
                    .write(true)
                    .create(true)
                    .truncate(false)
                    .open(&info_path)
                    .with_context(|| format!("open info file: {}", info_path.display()))?;
                write_lock_info(
                    &mut info_file,
                    LockInfo {
                        port,
                        pid: std::process::id(),
                    },
                )
                .context("write lock info")?;

                log_single_instance(&instance_key, &format!("primary lock-acquired port={port}"));

                Ok(EnsureOutcome::Primary(PrimaryInstance {
                    guard: SingleInstanceGuard {
                        _lock_file: lock_file,
                    },
                    focus_server: Some(focus_server),
                }))
            }
            Err(err) if is_lock_contended(&err) => {
                log_single_instance(
                    &instance_key,
                    &format!(
                        "secondary lock-contended; reading lock info from {}",
                        info_path.display()
                    ),
                );
                let info = match read_lock_info_with_retries(&info_path) {
                    Ok(info) => info,
                    Err(err) => {
                        log_single_instance(
                            &instance_key,
                            &format!("read lock info failed: {err:#}"),
                        );
                        return Err(err)
                            .with_context(|| format!("read lock info: {}", info_path.display()));
                    }
                };
                log_single_instance(
                    &instance_key,
                    &format!(
                        "secondary detected primary pid={} port={}",
                        info.pid, info.port
                    ),
                );
                send_focus_signal(info.port).context("send focus signal to primary instance")?;
                log_single_instance(&instance_key, "secondary sent UDP focus signal; exiting");
                Ok(EnsureOutcome::Secondary)
            }
            Err(err) => {
                log_single_instance(
                    &instance_key,
                    &format!(
                        "lock acquisition failed kind={:?} raw_os_error={:?}",
                        err.kind(),
                        err.raw_os_error()
                    ),
                );
                Err(err).with_context(|| format!("acquire lock: {}", lock_path.display()))
            }
        }
    }
}

#[cfg(windows)]
fn ensure_single_instance_windows(exe_path: &Path, instance_key: &str) -> Result<EnsureOutcome> {
    use windows::Win32::Foundation::{
        ERROR_ALREADY_EXISTS,
        GetLastError,
    };
    use windows::Win32::System::Threading::CreateMutexW;

    let mutex_name = format!("Local\\ffui.{instance_key}");
    let mutex_wide = to_wide_null(&mutex_name);
    let mutex = unsafe {
        CreateMutexW(
            None,
            false,
            windows::core::PCWSTR::from_raw(mutex_wide.as_ptr()),
        )
    }
    .with_context(|| format!("CreateMutexW({mutex_name})"))?;

    let already_exists = unsafe { GetLastError() == ERROR_ALREADY_EXISTS };
    log_single_instance(
        instance_key,
        &format!("startup exe={} mutex={mutex_name}", exe_path.display()),
    );

    if already_exists {
        log_single_instance(
            instance_key,
            "secondary mutex-already-exists; focusing existing",
        );
        let focused = focus_existing_instance_by_exe_with_retries(exe_path);
        log_single_instance(
            instance_key,
            &format!("secondary focus attempted ok={focused}"),
        );
        unsafe {
            use windows::Win32::Foundation::CloseHandle;
            let _ = CloseHandle(mutex);
        }
        return Ok(EnsureOutcome::Secondary);
    }

    log_single_instance(instance_key, "primary mutex-created; continuing startup");
    Ok(EnsureOutcome::Primary(PrimaryInstance {
        guard: SingleInstanceGuard { _mutex: mutex },
        focus_server: None,
    }))
}

#[cfg(windows)]
fn to_wide_null(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn focus_existing_instance_by_exe_with_retries(exe_path: &Path) -> bool {
    for _ in 0..40 {
        if windows_focus::focus_primary_window_by_exe_path_best_effort(exe_path) {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    false
}

#[cfg(not(windows))]
fn is_lock_contended(err: &std::io::Error) -> bool {
    err.kind() == ErrorKind::WouldBlock
}

#[cfg(not(windows))]
impl FocusServer {
    fn bind_loopback() -> Result<Self> {
        let socket = UdpSocket::bind((LOOPBACK_ADDR, 0)).context("bind udp socket")?;
        Ok(Self { socket })
    }

    fn port(&self) -> Result<u16> {
        Ok(self.socket.local_addr().context("read local addr")?.port())
    }

    pub fn spawn(self, app: AppHandle) {
        thread::spawn(move || {
            let mut buffer = [0u8; 64];
            loop {
                let Ok((_len, _from)) = self.socket.recv_from(&mut buffer) else {
                    continue;
                };
                let exe_path = current_exe_canonicalized();
                let instance_key = derive_instance_key(&exe_path);
                log_single_instance(&instance_key, "primary received UDP focus signal");
                focus_main_window_best_effort(&app);
            }
        });
    }
}

#[cfg(windows)]
impl FocusServer {
    pub fn spawn(self, _app: AppHandle) {}
}

#[cfg(not(windows))]
fn focus_main_window_best_effort(app: &AppHandle) {
    for _ in 0..20 {
        let (tx, rx) = mpsc::channel::<bool>();
        let app_handle = app.clone();
        if app
            .run_on_main_thread(move || {
                let focused = try_focus_main_window_once(&app_handle);
                let _ = tx.send(focused);
            })
            .is_ok()
            && matches!(rx.recv_timeout(Duration::from_millis(250)), Ok(true))
        {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(not(windows))]
fn try_focus_main_window_once(app: &AppHandle) -> bool {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        if !window.is_focused().unwrap_or(false) {
            let _ = window.request_user_attention(Some(UserAttentionType::Critical));
        }
        return true;
    }
    false
}

#[cfg(not(windows))]
fn send_focus_signal(port: u16) -> Result<()> {
    let socket = UdpSocket::bind((LOOPBACK_ADDR, 0)).context("bind udp sender")?;
    socket
        .send_to(FOCUS_MESSAGE, (LOOPBACK_ADDR, port))
        .with_context(|| format!("udp send to {LOOPBACK_ADDR}:{port}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn write_lock_info(lock_file: &mut std::fs::File, info: LockInfo) -> Result<()> {
    let payload = serde_json::to_vec(&info).context("serialize lock info")?;
    lock_file.set_len(0).context("truncate lock file")?;
    lock_file
        .seek(SeekFrom::Start(0))
        .context("seek lock file")?;
    lock_file.write_all(&payload).context("write lock file")?;
    lock_file.sync_all().ok();
    Ok(())
}

#[cfg(not(windows))]
fn read_lock_info_with_retries(lock_path: &Path) -> Result<LockInfo> {
    let mut last_error: Option<anyhow::Error> = None;
    for _ in 0..20 {
        match fs::read(lock_path) {
            Ok(bytes) => match serde_json::from_slice::<LockInfo>(&bytes) {
                Ok(info) => return Ok(info),
                Err(err) => last_error = Some(anyhow::Error::new(err)),
            },
            Err(err) => last_error = Some(anyhow::Error::new(err)),
        }
        thread::sleep(Duration::from_millis(25));
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("lock info unavailable")))
}

fn current_exe_canonicalized() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("unknown_exe"));
    fs::canonicalize(&exe).unwrap_or(exe)
}

#[cfg(not(windows))]
fn lock_path_for_key(instance_key: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("{LOCK_FILE_PREFIX}.{instance_key}.lock"));
    path
}

#[cfg(not(windows))]
fn info_path_for_key(instance_key: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("{LOCK_FILE_PREFIX}.{instance_key}.info.json"));
    path
}

pub fn derive_instance_key(path: &Path) -> String {
    // Deterministic, stable hash for cross-process instance identity.
    let bytes = path.to_string_lossy();
    format!("{:016x}", fnv1a_64(bytes.as_bytes()))
}

fn fnv1a_64(bytes: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x100000001b3;
    let mut hash = OFFSET_BASIS;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

#[cfg(test)]
mod tests;
