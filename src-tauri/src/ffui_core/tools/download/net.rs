use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};

use crate::ffui_core::network_proxy;
use crate::ffui_core::tools::probe::configure_background_command;
use crate::ffui_core::tools::resolve::tool_binary_name;
use crate::ffui_core::tools::types::ExternalToolKind;

fn build_reqwest_client(
    timeout: Duration,
    context_label: &'static str,
    proxy: &network_proxy::ResolvedNetworkProxy,
) -> Result<reqwest::Client> {
    use reqwest::Client;

    let builder = Client::builder().timeout(timeout);
    let builder = network_proxy::apply_reqwest_builder(builder, proxy);

    builder
        .build()
        .with_context(|| format!("failed to build HTTP client for {context_label}"))
}

pub(crate) fn aria2c_available() -> bool {
    let mut cmd = Command::new("aria2c");
    configure_background_command(&mut cmd);
    cmd.arg("--version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

pub(crate) fn download_file_with_aria2c(url: &str, dest: &Path) -> Result<()> {
    let dir = dest
        .parent()
        .ok_or_else(|| anyhow!("destination {} has no parent directory", dest.display()))?;
    fs::create_dir_all(dir).with_context(|| format!("failed to create {}", dir.display()))?;

    let filename = dest
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("destination {} has invalid file name", dest.display()))?;

    let mut cmd = Command::new("aria2c");
    configure_background_command(&mut cmd);
    let proxy = network_proxy::resolve_effective_proxy_once();
    network_proxy::apply_aria2c_args(&mut cmd, &proxy);
    let status = cmd
        .arg("--allow-overwrite=true")
        .arg("--auto-file-renaming=false")
        .arg("--dir")
        .arg(dir)
        .arg("--out")
        .arg(filename)
        .arg(url)
        .status()
        .with_context(|| format!("failed to spawn aria2c to download {url}"))?;

    if !status.success() {
        bail!("aria2c exited with status {status} while downloading {url}");
    }

    // Ensure the downloaded file is executable on Unix. Without this, a
    // successful aria2c download would still fail our verification probe
    // and trigger repeated downloads across app restarts.
    mark_download_executable_if_unix(dest)?;

    Ok(())
}

pub(crate) fn download_file_with_reqwest<F>(
    url: &str,
    dest: &Path,
    mut on_progress: F,
) -> Result<()>
where
    F: FnMut(u64, Option<u64>),
{
    let dir = dest
        .parent()
        .ok_or_else(|| anyhow!("destination {} has no parent directory", dest.display()))?;
    fs::create_dir_all(dir).with_context(|| format!("failed to create {}", dir.display()))?;

    tauri::async_runtime::block_on(async move {
        let proxy = network_proxy::resolve_effective_proxy_once();
        let client =
            build_reqwest_client(Duration::from_secs(30), "ffmpeg-static download", &proxy)?;

        let mut resp = client.get(url).send().await.with_context(|| {
            format!(
                "failed to download {} from {}",
                tool_binary_name(ExternalToolKind::Ffmpeg),
                url
            )
        })?;

        if !resp.status().is_success() {
            bail!(
                "download of {} from {} failed with status {}",
                tool_binary_name(ExternalToolKind::Ffmpeg),
                url,
                resp.status()
            );
        }

        let mut file = fs::File::create(dest)
            .with_context(|| format!("failed to create {}", dest.display()))?;

        let total_len = resp.content_length();
        let mut downloaded: u64 = 0;

        while let Some(chunk) = resp
            .chunk()
            .await
            .context("failed to read downloaded bytes")?
        {
            file.write_all(&chunk)
                .with_context(|| format!("failed to write {}", dest.display()))?;
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            on_progress(downloaded, total_len);
        }

        mark_download_executable_if_unix(dest)?;

        Ok(())
    })
}

pub(crate) fn download_bytes_with_reqwest<F>(url: &str, mut on_progress: F) -> Result<Vec<u8>>
where
    F: FnMut(u64, Option<u64>),
{
    tauri::async_runtime::block_on(async move {
        let proxy = network_proxy::resolve_effective_proxy_once();
        let client = build_reqwest_client(Duration::from_secs(30), "avifenc download", &proxy)?;

        let mut resp = client
            .get(url)
            .send()
            .await
            .with_context(|| format!("failed to download avifenc from {url}"))?;

        if !resp.status().is_success() {
            bail!(
                "download of avifenc from {} failed with status {}",
                url,
                resp.status()
            );
        }

        let total_len = resp.content_length();
        let mut downloaded: u64 = 0;
        let mut out = Vec::new();

        while let Some(chunk) = resp
            .chunk()
            .await
            .context("failed to read downloaded avifenc bytes")?
        {
            out.extend_from_slice(&chunk);
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            on_progress(downloaded, total_len);
        }

        Ok(out)
    })
}

/// Best-effort: mark a downloaded file as executable on Unix platforms.
/// On non-Unix platforms this is a no-op.
fn mark_download_executable_if_unix(_dest: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(_dest)
            .with_context(|| format!("failed to read metadata for {}", _dest.display()))?
            .permissions();
        // rwxr-xr-x
        perms.set_mode(0o755);
        fs::set_permissions(_dest, perms)
            .with_context(|| format!("failed to mark {} as executable", _dest.display()))?;
    }
    Ok(())
}

/// Lightweight HEAD to retrieve Content-Length when available. This is used
/// to provide determinate progress for aria2c-driven downloads.
pub(crate) fn content_length_head(url: &str) -> Option<u64> {
    tauri::async_runtime::block_on(async move {
        let proxy = network_proxy::resolve_effective_proxy_once();
        let client =
            build_reqwest_client(Duration::from_secs(5), "content-length probe", &proxy).ok()?;
        let resp = client.head(url).send().await.ok()?;
        resp.headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Mutex, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn clear_proxy_env_for_test() {
        let lock = ENV_LOCK.get_or_init(|| Mutex::new(()));
        let _guard = lock.lock().expect("ENV_LOCK poisoned");

        for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
            unsafe { std::env::remove_var(key) };
        }
        unsafe { std::env::set_var("NO_PROXY", "127.0.0.1,localhost") };
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
                                    if total >= 4
                                        && buf[..total].windows(4).any(|w| w == b"\r\n\r\n")
                                    {
                                        break;
                                    }
                                }
                                Err(err)
                                    if matches!(
                                        err.kind(),
                                        std::io::ErrorKind::WouldBlock
                                            | std::io::ErrorKind::TimedOut
                                    ) =>
                                {
                                    continue;
                                }
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

    #[test]
    fn reqwest_helpers_can_download_from_local_server() {
        clear_proxy_env_for_test();

        let body = b"hello from ffui".to_vec();
        let (url, server_handle) = spawn_local_http_server(body.clone());

        assert_eq!(content_length_head(&url), Some(body.len() as u64));

        let dir = tempfile::tempdir().expect("tempdir");
        let dest = dir.path().join("download.bin");

        let mut progress_calls: u32 = 0;
        download_file_with_reqwest(&url, &dest, |_downloaded, _total| {
            progress_calls += 1;
        })
        .expect("download_file_with_reqwest");

        assert!(
            progress_calls > 0,
            "progress callback must be invoked at least once"
        );
        assert_eq!(fs::read(&dest).expect("read downloaded file"), body);

        let bytes = download_bytes_with_reqwest(&url, |_downloaded, _total| {})
            .expect("download_bytes_with_reqwest");
        assert_eq!(bytes, body);

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
}
