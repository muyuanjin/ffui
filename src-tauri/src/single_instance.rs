use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Seek, SeekFrom, Write};
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use anyhow::{Context, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const LOCK_FILE_PREFIX: &str = "ffui";
const FOCUS_MESSAGE: &[u8] = b"focus";
const LOOPBACK_ADDR: &str = "127.0.0.1";

#[derive(Debug)]
pub struct SingleInstanceGuard {
    _lock_file: std::fs::File,
}

#[derive(Debug)]
pub struct FocusServer {
    socket: UdpSocket,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LockInfo {
    port: u16,
    pid: u32,
}

#[derive(Debug)]
pub struct PrimaryInstance {
    pub guard: SingleInstanceGuard,
    pub focus_server: FocusServer,
}

#[derive(Debug)]
pub enum EnsureOutcome {
    Primary(PrimaryInstance),
    Secondary,
}

pub fn ensure_single_instance_or_focus_existing() -> Result<EnsureOutcome> {
    let exe_path = current_exe_canonicalized();
    let instance_key = derive_instance_key(&exe_path);
    let lock_path = lock_path_for_key(&instance_key);

    let mut lock_file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .with_context(|| format!("open lock file: {}", lock_path.display()))?;

    match lock_file.try_lock_exclusive() {
        Ok(()) => {
            let focus_server =
                FocusServer::bind_loopback().context("bind loopback UDP focus socket")?;
            let port = focus_server.port()?;
            write_lock_info(
                &mut lock_file,
                LockInfo {
                    port,
                    pid: std::process::id(),
                },
            )
            .context("write lock info")?;

            Ok(EnsureOutcome::Primary(PrimaryInstance {
                guard: SingleInstanceGuard {
                    _lock_file: lock_file,
                },
                focus_server,
            }))
        }
        Err(err) if err.kind() == ErrorKind::WouldBlock => {
            let info = read_lock_info_with_retries(&lock_path)
                .with_context(|| format!("read lock info: {}", lock_path.display()))?;
            send_focus_signal(info.port).context("send focus signal to primary instance")?;
            Ok(EnsureOutcome::Secondary)
        }
        Err(err) => Err(err).with_context(|| format!("acquire lock: {}", lock_path.display())),
    }
}

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
                focus_main_window_best_effort(&app);
            }
        });
    }
}

fn focus_main_window_best_effort(app: &AppHandle) {
    for _ in 0..20 {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn send_focus_signal(port: u16) -> Result<()> {
    let socket = UdpSocket::bind((LOOPBACK_ADDR, 0)).context("bind udp sender")?;
    socket
        .send_to(FOCUS_MESSAGE, (LOOPBACK_ADDR, port))
        .with_context(|| format!("udp send to {LOOPBACK_ADDR}:{port}"))?;
    Ok(())
}

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

fn lock_path_for_key(instance_key: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("{LOCK_FILE_PREFIX}.{instance_key}.lock"));
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
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn derive_instance_key_is_deterministic_and_distinct() {
        let a1 = derive_instance_key(Path::new("/tmp/a"));
        let a2 = derive_instance_key(Path::new("/tmp/a"));
        let b = derive_instance_key(Path::new("/tmp/b"));

        assert_eq!(a1, a2);
        assert_ne!(a1, b);
    }

    #[test]
    fn lock_contention_blocks_second_handle() {
        let dir = tempfile::tempdir().expect("tempdir must be created");
        let lock_path = dir.path().join("ffui_test.lock");

        let file1 = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .expect("open lock file 1");
        file1.try_lock_exclusive().expect("first lock must succeed");

        let file2 = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .expect("open lock file 2");
        file2
            .try_lock_exclusive()
            .expect_err("second lock must fail while first lock is held");

        drop(file1);
        file2
            .try_lock_exclusive()
            .expect("lock must succeed after release");
    }

    #[test]
    fn focus_udp_signal_is_received_by_loopback_socket() {
        let server = FocusServer::bind_loopback().expect("bind loopback focus server");
        let port = server.port().expect("read focus server port");

        server
            .socket
            .set_read_timeout(Some(Duration::from_secs(1)))
            .expect("set read timeout");

        send_focus_signal(port).expect("send focus signal");

        let mut buffer = [0u8; 64];
        let (len, from) = server
            .socket
            .recv_from(&mut buffer)
            .expect("focus server must receive datagram");

        assert_eq!(&buffer[..len], FOCUS_MESSAGE);
        assert_eq!(from.ip().to_string(), LOOPBACK_ADDR);
    }

    #[test]
    fn lock_info_round_trip_is_readable() {
        let dir = tempfile::tempdir().expect("tempdir must be created");
        let lock_path = dir.path().join("ffui_test_info.lock");
        let mut lock_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .expect("open lock file");

        write_lock_info(&mut lock_file, LockInfo { port: 4242, pid: 7 }).expect("write lock info");

        let info = read_lock_info_with_retries(&lock_path).expect("read lock info");
        assert_eq!(info.port, 4242);
        assert_eq!(info.pid, 7);
    }
}
