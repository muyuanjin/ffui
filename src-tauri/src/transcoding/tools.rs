use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::transcoding::settings::ExternalToolSettings;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExternalToolKind {
    Ffmpeg,
    Ffprobe,
    Avifenc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalToolStatus {
    pub kind: ExternalToolKind,
    pub resolved_path: Option<String>,
    pub source: Option<String>,
    pub version: Option<String>,
    pub update_available: bool,
    pub auto_download_enabled: bool,
    pub auto_update_enabled: bool,
}

#[derive(Debug, Deserialize)]
struct FfBinariesBinEntry {
    ffmpeg: Option<String>,
    ffprobe: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfBinariesLatest {
    version: String,
    bin: HashMap<String, FfBinariesBinEntry>,
}

// Ensure helper commands (version checks, probes, etc.) do not pop up visible
// console windows on Windows. On other platforms this is a no-op.
#[cfg(windows)]
fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_background_command(_cmd: &mut Command) {}

fn tool_binary_name(kind: ExternalToolKind) -> &'static str {
    match kind {
        ExternalToolKind::Ffmpeg => "ffmpeg",
        ExternalToolKind::Ffprobe => "ffprobe",
        ExternalToolKind::Avifenc => "avifenc",
    }
}

fn custom_path_for(kind: ExternalToolKind, settings: &ExternalToolSettings) -> Option<String> {
    match kind {
        ExternalToolKind::Ffmpeg => settings.ffmpeg_path.clone(),
        ExternalToolKind::Ffprobe => settings.ffprobe_path.clone(),
        ExternalToolKind::Avifenc => settings.avifenc_path.clone(),
    }
}

pub fn resolve_tool_path(
    kind: ExternalToolKind,
    settings: &ExternalToolSettings,
) -> Result<(String, String)> {
    if let Some(custom) = custom_path_for(kind, settings) {
        return Ok((custom, "custom".to_string()));
    }

    // Prefer a previously auto-downloaded binary next to the executable if it exists.
    if let Some(downloaded) = downloaded_tool_path(kind) {
        return Ok((
            downloaded.to_string_lossy().into_owned(),
            "download".to_string(),
        ));
    }

    let bin = tool_binary_name(kind).to_string();
    // Using bare binary name relies on system PATH; this matches the spec requirement.
    Ok((bin, "path".to_string()))
}

pub fn ensure_tool_available(
    kind: ExternalToolKind,
    settings: &ExternalToolSettings,
) -> Result<(String, String)> {
    let (mut path, mut source) = resolve_tool_path(kind, settings)?;

    if !verify_tool_binary(&path) && settings.auto_download {
        // Attempt to download a fresh binary for this platform.
        match download_tool_binary(kind) {
            Ok(downloaded) => {
                path = downloaded.to_string_lossy().into_owned();
                source = "download".to_string();
            }
            Err(err) => {
                return Err(anyhow!(
                    "{} not found and auto-download failed: {err}",
                    tool_binary_name(kind)
                ));
            }
        }
    }

    if !verify_tool_binary(&path) {
        return Err(anyhow!(
            "{} does not appear to be available. Install it or configure a custom path.",
            tool_binary_name(kind)
        ));
    }

    // Optionally auto-update when a newer version is available.
    if settings.auto_update {
        if let (Some(remote), Some(local)) = (
            latest_remote_version(kind),
            detect_local_tool_version(&path, kind),
        ) {
            if !local.contains(&remote) {
                if let Ok(downloaded) = download_tool_binary(kind) {
                    let new_path = downloaded.to_string_lossy().into_owned();
                    if verify_tool_binary(&new_path) {
                        path = new_path;
                        source = "download".to_string();
                    }
                }
            }
        }
    }

    Ok((path, source))
}

pub fn tool_status(kind: ExternalToolKind, settings: &ExternalToolSettings) -> ExternalToolStatus {
    let auto_download_enabled = settings.auto_download;
    let auto_update_enabled = settings.auto_update;

    // For status reporting we prefer a lightweight, best-effort probe:
    // resolve the path and, if possible, grab a version line in a single process
    // spawn. This avoids double-spawning the tool just to confirm availability.
    let (resolved_path, source, version, update_available) = match resolve_tool_path(kind, settings)
    {
        Ok((path, source)) => {
            let version = detect_local_tool_version(&path, kind);
            let remote = latest_remote_version(kind);
            let update_available = match (&version, &remote) {
                (Some(local), Some(remote)) => auto_update_enabled && !local.contains(remote),
                _ => false,
            };
            (Some(path), Some(source), version, update_available)
        }
        Err(_) => (None, None, None, false),
    };

    ExternalToolStatus {
        kind,
        resolved_path,
        source,
        version,
        update_available,
        auto_download_enabled,
        auto_update_enabled,
    }
}

fn tools_dir() -> Result<PathBuf> {
    let exe = std::env::current_exe().context("failed to resolve current executable")?;
    let dir = exe
        .parent()
        .map(Path::to_path_buf)
        .context("failed to resolve executable directory")?;
    let tools = dir.join("tools");
    fs::create_dir_all(&tools)
        .with_context(|| format!("failed to create tools directory {}", tools.display()))?;
    Ok(tools)
}

fn downloaded_tool_filename(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn downloaded_tool_path(kind: ExternalToolKind) -> Option<PathBuf> {
    let base = tool_binary_name(kind);
    let filename = downloaded_tool_filename(base);
    let dir = tools_dir().ok()?;
    let candidate = dir.join(filename);
    if candidate.exists() {
        Some(candidate)
    } else {
        None
    }
}

fn verify_tool_binary(path: &str) -> bool {
    // Prefer `-version` which works for ffmpeg/ffprobe and avoids the
    // non-zero exit code some builds use for `--version`.
    let mut cmd = Command::new(path);
    configure_background_command(&mut cmd);
    cmd.arg("-version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn detect_local_tool_version(path: &str, _kind: ExternalToolKind) -> Option<String> {
    let mut cmd = Command::new(path);
    configure_background_command(&mut cmd);
    cmd.arg("-version")
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
}

fn latest_remote_version(kind: ExternalToolKind) -> Option<String> {
    match kind {
        ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe => {
            // Cache the remote version for the lifetime of the process so we
            // avoid hitting the network on every job. In constrained network
            // environments this prevents "transcode hangs at start" behaviour
            // when auto-update is enabled.
            static FFBINARIES_VERSION: OnceLock<Option<String>> = OnceLock::new();
            FFBINARIES_VERSION
                .get_or_init(|| get_ffbinaries_latest().ok().map(|meta| meta.version))
                .clone()
        }
        ExternalToolKind::Avifenc => None,
    }
}

fn get_ffbinaries_latest() -> Result<FfBinariesLatest> {
    use reqwest::blocking::Client;
    use std::time::Duration;

    // Use a short, global timeout for metadata fetches so that environments
    // where ffbinaries.com is slow or unreachable do not block transcoding
    // jobs for an unbounded amount of time when auto-update is enabled.
    let client = Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .context("failed to build HTTP client for ffbinaries")?;

    let resp = client
        .get("https://ffbinaries.com/api/v1/version/latest")
        .send()
        .context("failed to download ffmpeg metadata from ffbinaries")?;
    let latest: FfBinariesLatest = resp
        .json()
        .context("failed to parse ffbinaries version response")?;
    Ok(latest)
}

fn ffbinaries_platform_key() -> Option<&'static str> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("windows", "x86_64") => Some("windows-64"),
        ("linux", "x86_64") => Some("linux-64"),
        ("linux", "x86") => Some("linux-32"),
        ("linux", "arm") | ("linux", "armv7") => Some("linux-armhf"),
        _ => None,
    }
}

fn download_tool_binary(kind: ExternalToolKind) -> Result<PathBuf> {
    match kind {
        ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe => download_via_ffbinaries(kind),
        ExternalToolKind::Avifenc => Err(anyhow!(
            "auto-download for avifenc is not implemented; please install it manually or configure a custom path"
        )),
    }
}

fn download_via_ffbinaries(kind: ExternalToolKind) -> Result<PathBuf> {
    let platform = ffbinaries_platform_key().ok_or_else(|| {
        anyhow!(
            "auto-download for {} is not supported on this platform",
            tool_binary_name(kind)
        )
    })?;

    let latest = get_ffbinaries_latest()?;
    let entry = latest.bin.get(platform).ok_or_else(|| {
        anyhow!(
            "no ffbinaries entry for platform {platform} when downloading {}",
            tool_binary_name(kind)
        )
    })?;

    let url_opt = match kind {
        ExternalToolKind::Ffmpeg => &entry.ffmpeg,
        ExternalToolKind::Ffprobe => &entry.ffprobe,
        ExternalToolKind::Avifenc => &None,
    };

    let url = url_opt.as_deref().ok_or_else(|| {
        anyhow!(
            "ffbinaries did not provide a URL for {} on platform {platform}",
            tool_binary_name(kind)
        )
    })?;

    let resp = reqwest::blocking::get(url)
        .with_context(|| format!("failed to download {} from {url}", tool_binary_name(kind)))?;

    if !resp.status().is_success() {
        bail!(
            "download of {} from {url} failed with status {}",
            tool_binary_name(kind),
            resp.status()
        );
    }

    let bytes = resp.bytes().context("failed to read downloaded archive")?;
    extract_binary_from_zip(&bytes, tool_binary_name(kind))
}

fn extract_binary_from_zip(data: &[u8], tool_name: &str) -> Result<PathBuf> {
    let reader = Cursor::new(data);
    let mut archive =
        zip::ZipArchive::new(reader).context("failed to open downloaded zip archive")?;

    let target_name = downloaded_tool_filename(tool_name);
    let mut found_index: Option<usize> = None;

    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .with_context(|| format!("failed to read zip entry at index {i}"))?;
        let name = file.name().to_string();
        if !file.is_dir() && name.ends_with(&target_name) {
            found_index = Some(i);
            break;
        }
    }

    let idx = found_index
        .ok_or_else(|| anyhow!("could not find {target_name} inside downloaded archive"))?;

    let mut file = archive
        .by_index(idx)
        .with_context(|| format!("failed to open zip entry {idx} for extraction"))?;

    let dir = tools_dir()?;
    let dest_path = dir.join(&target_name);
    {
        let mut out = fs::File::create(&dest_path)
            .with_context(|| format!("failed to create {}", dest_path.display()))?;
        std::io::copy(&mut file, &mut out)
            .with_context(|| format!("failed to extract {}", dest_path.display()))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&dest_path)
            .with_context(|| format!("failed to read metadata for {}", dest_path.display()))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&dest_path, perms)
            .with_context(|| format!("failed to mark {} as executable", dest_path.display()))?;
    }

    Ok(dest_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs::{self, File};
    use std::io::Write;

    #[test]
    fn verify_tool_binary_handles_tools_that_fail_on_long_version_flag() {
        let dir = env::temp_dir();

        #[cfg(windows)]
        {
            let path = dir.join("fake_ffmpeg.bat");
            let mut file = File::create(&path).expect("create fake ffmpeg .bat");
            writeln!(file, "@echo off").unwrap();
            writeln!(file, "if \"%1\"==\"--version\" exit /b 8").unwrap();
            writeln!(file, "if \"%1\"==\"-version\" exit /b 0").unwrap();
            writeln!(file, "exit /b 1").unwrap();

            assert!(verify_tool_binary(path.to_string_lossy().as_ref()));
            let _ = fs::remove_file(&path);
        }

        #[cfg(not(windows))]
        {
            let path = dir.join("fake_ffmpeg.sh");
            let mut file = File::create(&path).expect("create fake ffmpeg script");
            writeln!(file, "#!/usr/bin/env sh").unwrap();
            writeln!(file, "if [ \"$1\" = \"--version\" ]; then exit 8; fi").unwrap();
            writeln!(file, "if [ \"$1\" = \"-version\" ]; then exit 0; fi").unwrap();
            writeln!(file, "exit 1").unwrap();

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = fs::metadata(&path)
                    .expect("read permissions for fake ffmpeg script")
                    .permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&path, perms).expect("mark fake ffmpeg script as executable");
            }

            assert!(verify_tool_binary(path.to_string_lossy().as_ref()));
            let _ = fs::remove_file(&path);
        }
    }
}
