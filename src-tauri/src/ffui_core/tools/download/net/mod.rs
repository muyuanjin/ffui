use std::fs;
use std::io::{BufWriter, Read, Write};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};

use crate::ffui_core::network_proxy;
use crate::ffui_core::tools::probe::configure_background_command;
use crate::ffui_core::tools::resolve::tool_binary_name;
use crate::ffui_core::tools::types::ExternalToolKind;

#[derive(Debug, Clone, Default)]
pub(crate) struct NetworkAttemptInfo {
    pub(crate) used_proxy: bool,
    pub(crate) fell_back_to_direct: bool,
    pub(crate) message: Option<String>,
}

fn send_reqwest_blocking_with_proxy_fallback(
    proxy_client: Option<&reqwest::blocking::Client>,
    direct_client: &reqwest::blocking::Client,
    resolved: &network_proxy::ResolvedNetworkProxy,
    info: &mut NetworkAttemptInfo,
    send: impl Fn(&reqwest::blocking::Client) -> Result<reqwest::blocking::Response>,
) -> Result<reqwest::blocking::Response> {
    if let Some(client) = proxy_client {
        match send(client) {
            Ok(resp) => Ok(resp),
            Err(err) => {
                if resolved.fallback_to_direct_on_error() {
                    info.fell_back_to_direct = true;
                    info.message = Some(format!(
                        "[proxy] request failed; falling back to direct: {err:#}"
                    ));
                    send(direct_client)
                } else {
                    Err(err)
                }
            }
        }
    } else {
        send(direct_client)
    }
}

fn build_reqwest_blocking_client(
    timeout: Duration,
    context_label: &'static str,
    proxy: Option<reqwest::Proxy>,
    force_no_proxy: bool,
) -> Result<reqwest::blocking::Client> {
    use reqwest::blocking::Client;

    let mut builder = Client::builder().timeout(timeout);
    if force_no_proxy {
        builder = builder.no_proxy();
    }
    if let Some(proxy) = proxy {
        builder = builder.proxy(proxy);
    }

    builder
        .build()
        .with_context(|| format!("failed to build HTTP client for {context_label}"))
}

fn resolve_proxy_plan(
    resolved: &network_proxy::ResolvedNetworkProxy,
) -> Result<(Option<network_proxy::ParsedReqwestProxy>, Option<String>)> {
    match network_proxy::parse_reqwest_proxy_for(resolved) {
        Ok(parsed) => Ok((parsed, None)),
        Err(err) => {
            if resolved.fallback_to_direct_on_error() {
                Ok((
                    None,
                    Some(format!(
                        "[proxy] invalid proxy URL; falling back to direct: {err:#}"
                    )),
                ))
            } else {
                Err(err)
            }
        }
    }
}

pub(crate) fn aria2c_available() -> bool {
    let mut cmd = Command::new("aria2c");
    configure_background_command(&mut cmd);
    cmd.arg("--version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

pub(crate) fn download_file_with_aria2c(url: &str, dest: &Path) -> Result<NetworkAttemptInfo> {
    let dir = dest
        .parent()
        .ok_or_else(|| anyhow!("destination {} has no parent directory", dest.display()))?;
    fs::create_dir_all(dir).with_context(|| format!("failed to create {}", dir.display()))?;

    let filename = dest
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("destination {} has invalid file name", dest.display()))?;

    let resolved = network_proxy::resolve_effective_proxy_once();
    let (parsed_proxy, plan_message) = resolve_proxy_plan(&resolved)?;
    let force_no_proxy = resolved.is_no_proxy_mode();

    let mut info = NetworkAttemptInfo {
        message: plan_message,
        ..Default::default()
    };

    let run = |use_proxy: bool| -> Result<()> {
        let mut cmd = Command::new("aria2c");
        configure_background_command(&mut cmd);

        if force_no_proxy || !use_proxy {
            cmd.arg("--all-proxy=").arg("--no-proxy=*");
        } else {
            network_proxy::apply_aria2c_args(&mut cmd, &resolved);
        }

        let status = cmd
            .arg("--allow-overwrite=true")
            .arg("--auto-file-renaming=false")
            .arg("--file-allocation=none")
            .arg("--split=1")
            .arg("--max-connection-per-server=1")
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
        Ok(())
    };

    let can_try_proxy = !force_no_proxy && parsed_proxy.is_some();
    if can_try_proxy {
        info.used_proxy = true;
        if let Err(err) = run(true) {
            if resolved.fallback_to_direct_on_error() {
                info.fell_back_to_direct = true;
                info.message = Some(format!(
                    "[proxy] aria2c failed; falling back to direct: {err:#}"
                ));
                drop(fs::remove_file(dest));
                run(false)?;
            } else {
                return Err(err);
            }
        }
    } else {
        run(false)?;
    }

    // Ensure the downloaded file is executable on Unix. Without this, a
    // successful aria2c download would still fail our verification probe
    // and trigger repeated downloads across app restarts.
    mark_download_executable_if_unix(dest)?;

    Ok(info)
}

pub(crate) fn download_file_with_reqwest<F>(
    url: &str,
    dest: &Path,
    mut on_progress: F,
) -> Result<NetworkAttemptInfo>
where
    F: FnMut(u64, Option<u64>),
{
    let dir = dest
        .parent()
        .ok_or_else(|| anyhow!("destination {} has no parent directory", dest.display()))?;
    fs::create_dir_all(dir).with_context(|| format!("failed to create {}", dir.display()))?;

    let resolved = network_proxy::resolve_effective_proxy_once();
    let (parsed_proxy, plan_message) = resolve_proxy_plan(&resolved)?;

    let mut info = NetworkAttemptInfo {
        message: plan_message,
        ..Default::default()
    };

    let force_no_proxy = resolved.is_no_proxy_mode();
    let (proxy_client, direct_client) = if force_no_proxy {
        (
            None,
            build_reqwest_blocking_client(
                Duration::from_secs(30),
                "ffmpeg-static download (direct)",
                None,
                true,
            )?,
        )
    } else if let Some(parsed) = parsed_proxy {
        info.used_proxy = true;
        let proxy_client = build_reqwest_blocking_client(
            Duration::from_secs(30),
            "ffmpeg-static download (proxy)",
            Some(parsed.proxy),
            false,
        )?;
        let direct_client = build_reqwest_blocking_client(
            Duration::from_secs(30),
            "ffmpeg-static download (direct fallback)",
            None,
            true,
        )?;
        (Some(proxy_client), direct_client)
    } else {
        (
            None,
            build_reqwest_blocking_client(
                Duration::from_secs(30),
                "ffmpeg-static download",
                None,
                false,
            )?,
        )
    };

    let send = |client: &reqwest::blocking::Client| {
        client.get(url).send().with_context(|| {
            format!(
                "failed to download {} from {}",
                tool_binary_name(ExternalToolKind::Ffmpeg),
                url
            )
        })
    };

    let mut resp = send_reqwest_blocking_with_proxy_fallback(
        proxy_client.as_ref(),
        &direct_client,
        &resolved,
        &mut info,
        send,
    )?;

    if !resp.status().is_success() {
        bail!(
            "download of {} from {} failed with status {}",
            tool_binary_name(ExternalToolKind::Ffmpeg),
            url,
            resp.status()
        );
    }

    let file =
        fs::File::create(dest).with_context(|| format!("failed to create {}", dest.display()))?;
    let mut file = BufWriter::new(file);

    let total_len = resp.content_length();
    let mut downloaded: u64 = 0;
    let mut buf = [0u8; 64 * 1024];

    loop {
        let n = resp
            .read(&mut buf)
            .with_context(|| format!("failed to read downloaded bytes from {url}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .with_context(|| format!("failed to write {}", dest.display()))?;
        downloaded = downloaded.saturating_add(n as u64);
        on_progress(downloaded, total_len);
    }
    file.flush()
        .with_context(|| format!("failed to flush {}", dest.display()))?;

    mark_download_executable_if_unix(dest)?;

    Ok(info)
}

pub(crate) fn download_bytes_with_reqwest<F>(
    url: &str,
    mut on_progress: F,
) -> Result<(Vec<u8>, NetworkAttemptInfo)>
where
    F: FnMut(u64, Option<u64>),
{
    const PREFETCH_CAPACITY_LIMIT_BYTES: usize = 16 * 1024 * 1024;

    let resolved = network_proxy::resolve_effective_proxy_once();
    let (parsed_proxy, plan_message) = resolve_proxy_plan(&resolved)?;

    let mut info = NetworkAttemptInfo {
        message: plan_message,
        ..Default::default()
    };

    let force_no_proxy = resolved.is_no_proxy_mode();
    let (proxy_client, direct_client) = if force_no_proxy {
        (
            None,
            build_reqwest_blocking_client(
                Duration::from_secs(30),
                "avifenc download (direct)",
                None,
                true,
            )?,
        )
    } else if let Some(parsed) = parsed_proxy {
        info.used_proxy = true;
        let proxy_client = build_reqwest_blocking_client(
            Duration::from_secs(30),
            "avifenc download (proxy)",
            Some(parsed.proxy),
            false,
        )?;
        let direct_client = build_reqwest_blocking_client(
            Duration::from_secs(30),
            "avifenc download (direct fallback)",
            None,
            true,
        )?;
        (Some(proxy_client), direct_client)
    } else {
        (
            None,
            build_reqwest_blocking_client(
                Duration::from_secs(30),
                "avifenc download",
                None,
                false,
            )?,
        )
    };

    let send = |client: &reqwest::blocking::Client| {
        client
            .get(url)
            .send()
            .with_context(|| format!("failed to download avifenc from {url}"))
    };

    let mut resp = send_reqwest_blocking_with_proxy_fallback(
        proxy_client.as_ref(),
        &direct_client,
        &resolved,
        &mut info,
        send,
    )?;

    if !resp.status().is_success() {
        bail!(
            "download of avifenc from {} failed with status {}",
            url,
            resp.status()
        );
    }

    let total_len = resp.content_length();
    let mut out = total_len
        .and_then(|n| usize::try_from(n).ok())
        .map_or_else(Vec::new, |total| {
            Vec::with_capacity(total.min(PREFETCH_CAPACITY_LIMIT_BYTES))
        });

    let mut downloaded: u64 = 0;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = resp
            .read(&mut buf)
            .with_context(|| format!("failed to read downloaded avifenc bytes from {url}"))?;
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        downloaded = downloaded.saturating_add(n as u64);
        on_progress(downloaded, total_len);
    }

    Ok((out, info))
}

/// Best-effort: mark a downloaded file as executable on Unix platforms.
/// On non-Unix platforms this is a no-op.
#[allow(clippy::missing_const_for_fn)]
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

/// Lightweight HEAD to retrieve Content-Length when available.
pub(crate) fn content_length_head(url: &str) -> Option<u64> {
    use reqwest::blocking::Client;

    let resolved = network_proxy::resolve_effective_proxy_once();
    let force_no_proxy = resolved.is_no_proxy_mode();

    let builder = Client::builder().timeout(Duration::from_secs(5));
    let builder = if force_no_proxy {
        builder.no_proxy()
    } else {
        builder
    };
    let client = builder.build().ok()?;

    let resp = client.head(url).send().ok()?;
    if resp.status().is_success() {
        return resp
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .or_else(|| resp.content_length());
    }

    // Some servers reject HEAD (405) or return redirects that do not surface
    // a useful Content-Length. Best-effort: try a tiny ranged GET to learn the
    // total size without downloading the whole file.
    let resp = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .ok()?;
    if resp.status().is_success() || resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        if let Some(total) = resp
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|h| h.to_str().ok())
            .and_then(parse_content_range_total)
        {
            return Some(total);
        }
        return resp.content_length();
    }
    None
}

fn parse_content_range_total(value: &str) -> Option<u64> {
    // Examples:
    // - "bytes 0-0/12345"
    // - "bytes */12345"
    let total = value.rsplit('/').next()?.trim();
    if total == "*" {
        return None;
    }
    total.parse().ok()
}

#[cfg(test)]
mod tests;
