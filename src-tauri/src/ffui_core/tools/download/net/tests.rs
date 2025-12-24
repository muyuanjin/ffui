use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::MutexGuard;
use std::thread;
use std::time::{Duration, Instant};

use super::*;
use crate::ffui_core::network_proxy;
use crate::ffui_core::settings::{NetworkProxyMode, NetworkProxySettings};
use crate::test_support::{EnvVarGuard, env_lock, remove_env, set_env};

fn prepare_proxy_env_for_test() -> (MutexGuard<'static, ()>, EnvVarGuard) {
    let lock = env_lock();
    let guard = EnvVarGuard::capture([
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "NO_PROXY",
    ]);
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        remove_env(key);
    }
    set_env("NO_PROXY", "127.0.0.1,localhost");
    (lock, guard)
}

fn spawn_local_http_server(body: Vec<u8>) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind test server");
    let addr = listener.local_addr().expect("server addr");
    let url = format!("http://127.0.0.1:{}/", addr.port());
    listener
        .set_nonblocking(true)
        .expect("set listener nonblocking");

    let handle = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut served: usize = 0;
        while Instant::now() < deadline && served < 8 {
            match listener.accept() {
                Ok((mut stream, _peer)) => {
                    served += 1;
                    // `TcpListener::set_nonblocking(true)` can make accepted streams nonblocking
                    // on some platforms. Ensure the connection behaves like a normal blocking
                    // socket so we don't end up writing partial HTTP headers.
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));

                    let mut buf = [0u8; 16 * 1024];
                    let mut total: usize = 0;
                    let read_deadline = Instant::now() + Duration::from_millis(250);
                    while total < buf.len() && Instant::now() < read_deadline {
                        match stream.read(&mut buf[total..]) {
                            Ok(0) => break,
                            Ok(n) => {
                                total += n;
                                if total >= 4 && buf[..total].windows(4).any(|w| w == b"\r\n\r\n") {
                                    break;
                                }
                            }
                            Err(err)
                                if matches!(
                                    err.kind(),
                                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                                ) => {}
                            Err(_) => break,
                        }
                    }

                    let req = String::from_utf8_lossy(&buf[..total]);
                    let method = req.split_whitespace().next().unwrap_or("");

                    let headers = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(headers.as_bytes());
                    if method != "HEAD" {
                        let _ = stream.write_all(&body);
                    }
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
    });

    (url, handle)
}

struct ProxySettingsGuard {
    prev: (NetworkProxyMode, Option<String>, bool),
}

impl ProxySettingsGuard {
    fn capture() -> Self {
        Self {
            prev: network_proxy::snapshot(),
        }
    }
}

impl Drop for ProxySettingsGuard {
    fn drop(&mut self) {
        let (mode, proxy_url, fallback_to_direct_on_error) = self.prev.clone();
        network_proxy::apply_settings(Some(&NetworkProxySettings {
            mode,
            proxy_url,
            fallback_to_direct_on_error,
        }));
    }
}

#[test]
fn reqwest_helpers_can_download_from_local_server() {
    let (_env_lock, _env_guard) = prepare_proxy_env_for_test();

    let body = b"hello from ffui".to_vec();
    let (url, server_handle) = spawn_local_http_server(body.clone());

    assert_eq!(content_length_head(&url), Some(body.len() as u64));

    let dir = tempfile::tempdir().expect("tempdir");
    let dest = dir.path().join("download.bin");

    let mut progress_calls: u32 = 0;
    let _info = download_file_with_reqwest(&url, &dest, |_downloaded, _total| {
        progress_calls += 1;
    })
    .expect("download_file_with_reqwest");

    assert!(
        progress_calls > 0,
        "progress callback must be invoked at least once"
    );
    assert_eq!(fs::read(&dest).expect("read downloaded file"), body);

    let (bytes, _info) = download_bytes_with_reqwest(&url, |_downloaded, _total| {})
        .expect("download_bytes_with_reqwest");
    assert_eq!(bytes, body);

    server_handle.join().expect("server thread");
}

#[test]
fn reqwest_helpers_fall_back_to_direct_when_proxy_fails() {
    let (_env_lock, _env_guard) = prepare_proxy_env_for_test();
    let _proxy_guard = ProxySettingsGuard::capture();

    network_proxy::apply_settings(Some(&NetworkProxySettings {
        mode: NetworkProxyMode::Custom,
        proxy_url: Some("http://127.0.0.1:9".to_string()),
        fallback_to_direct_on_error: true,
    }));

    let body = b"hello from ffui".to_vec();
    let (url, server_handle) = spawn_local_http_server(body.clone());

    let dir = tempfile::tempdir().expect("tempdir");
    let dest = dir.path().join("download.bin");
    let info = download_file_with_reqwest(&url, &dest, |_downloaded, _total| {})
        .expect("download should succeed via direct fallback");
    assert!(
        info.fell_back_to_direct,
        "should record that proxy fallback was used"
    );
    assert!(
        info.message
            .as_deref()
            .unwrap_or_default()
            .starts_with("[proxy]"),
        "should carry a proxy warning message"
    );
    assert_eq!(fs::read(&dest).expect("read downloaded file"), body);

    server_handle.join().expect("server thread");
}

#[cfg(unix)]
#[test]
fn mark_download_executable_sets_exec_bits_on_unix() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().expect("create temp dir");
    let path = dir.path().join("ffmpeg-static");
    fs::write(&path, b"#!/bin/sh\nexit 0\n").expect("write temp file");

    // Start with 0644
    let mut perms = fs::metadata(&path).expect("metadata").permissions();
    perms.set_mode(0o644);
    fs::set_permissions(&path, perms).expect("set perms 0644");

    mark_download_executable_if_unix(&path).expect("mark executable");

    let mode = fs::metadata(&path).expect("metadata").permissions().mode() & 0o777;
    assert_eq!(mode, 0o755, "downloaded file must become executable");
}
