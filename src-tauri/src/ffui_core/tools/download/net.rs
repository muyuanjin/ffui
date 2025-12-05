use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, anyhow, bail};

use crate::ffui_core::tools::probe::configure_background_command;
use crate::ffui_core::tools::resolve::tool_binary_name;
use crate::ffui_core::tools::types::ExternalToolKind;

pub(crate) fn proxy_from_env() -> Option<String> {
    for key in &["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(v) = std::env::var(key)
            && !v.trim().is_empty()
        {
            return Some(v);
        }
    }
    None
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
    use reqwest::Proxy;
    use reqwest::blocking::Client;
    use std::time::Duration;

    let dir = dest
        .parent()
        .ok_or_else(|| anyhow!("destination {} has no parent directory", dest.display()))?;
    fs::create_dir_all(dir).with_context(|| format!("failed to create {}", dir.display()))?;

    let mut builder = Client::builder().timeout(Duration::from_secs(30));

    if let Some(proxy_url) = proxy_from_env()
        && let Ok(proxy) = Proxy::all(&proxy_url)
    {
        builder = builder.proxy(proxy);
    }

    let client = builder
        .build()
        .context("failed to build HTTP client for ffmpeg-static download")?;

    let mut resp = client.get(url).send().with_context(|| {
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

    let mut file =
        fs::File::create(dest).with_context(|| format!("failed to create {}", dest.display()))?;

    let total_len = resp.content_length();
    let mut downloaded: u64 = 0;
    let mut buf = [0u8; 8192];

    loop {
        let n = resp
            .read(&mut buf)
            .context("failed to read downloaded bytes")?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .with_context(|| format!("failed to write {}", dest.display()))?;
        downloaded += n as u64;
        on_progress(downloaded, total_len);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(dest)
            .with_context(|| format!("failed to read metadata for {}", dest.display()))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(dest, perms)
            .with_context(|| format!("failed to mark {} as executable", dest.display()))?;
    }

    Ok(())
}

pub(crate) fn download_bytes_with_reqwest<F>(url: &str, mut on_progress: F) -> Result<Vec<u8>>
where
    F: FnMut(u64, Option<u64>),
{
    use reqwest::Proxy;
    use reqwest::blocking::Client;
    use std::time::Duration;

    let mut builder = Client::builder().timeout(Duration::from_secs(30));

    if let Some(proxy_url) = proxy_from_env()
        && let Ok(proxy) = Proxy::all(&proxy_url)
    {
        builder = builder.proxy(proxy);
    }

    let client = builder
        .build()
        .context("failed to build HTTP client for avifenc download")?;

    let mut resp = client
        .get(url)
        .send()
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
    let mut buf = [0u8; 8192];

    loop {
        let n = resp
            .read(&mut buf)
            .context("failed to read downloaded avifenc bytes")?;
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        downloaded += n as u64;
        on_progress(downloaded, total_len);
    }

    Ok(out)
}
