use anyhow::{Result, anyhow};

#[cfg(not(test))]
use crate::ffui_core::network_proxy;
use crate::ffui_core::tools::types::*;
use crate::sync_ext::MutexExt;

pub(crate) fn semantic_version_from_tag(tag: &str) -> String {
    let idx = tag.find(|c: char| c.is_ascii_digit()).unwrap_or(0);
    tag[idx..].to_string()
}

/// Best-effort remote check against GitHub Releases.
///
/// Returns None when the network request fails. When it succeeds, this also
/// updates the in-process `FFMPEG_RELEASE_CACHE` so subsequent status snapshots
/// can reuse the latest remote version without repeating network calls.
pub(crate) fn try_refresh_ffmpeg_release_from_github() -> Option<FfmpegStaticRelease> {
    let tag = fetch_ffmpeg_release_from_github()?;
    let version = semantic_version_from_tag(&tag);
    let info = FfmpegStaticRelease {
        version: version.clone(),
        tag: tag.clone(),
    };

    let mut cache = FFMPEG_RELEASE_CACHE.lock_unpoisoned();
    *cache = Some(info.clone());
    Some(info)
}

/// Best-effort remote check against GitHub Releases for libavif.
///
/// Returns None when the network request fails. When it succeeds, this also
/// updates the in-process `LIBAVIF_RELEASE_CACHE` so subsequent status snapshots
/// can reuse the latest remote version without repeating network calls.
pub(crate) fn try_refresh_libavif_release_from_github() -> Option<LibavifRelease> {
    let tag = fetch_libavif_release_from_github()?;
    let version = semantic_version_from_tag(&tag);
    let info = LibavifRelease {
        version: version.clone(),
        tag: tag.clone(),
    };

    let mut cache = LIBAVIF_RELEASE_CACHE.lock_unpoisoned();
    *cache = Some(info.clone());
    Some(info)
}

pub(crate) fn current_ffmpeg_release() -> FfmpegStaticRelease {
    {
        let cache = FFMPEG_RELEASE_CACHE.lock_unpoisoned();
        if let Some(info) = cache.as_ref() {
            return info.clone();
        }
    }

    let from_github = fetch_ffmpeg_release_from_github();
    let info = match from_github {
        Some(tag) => {
            let version = semantic_version_from_tag(&tag);
            FfmpegStaticRelease { version, tag }
        }
        None => FfmpegStaticRelease {
            version: FFMPEG_STATIC_VERSION.to_string(),
            tag: FFMPEG_STATIC_TAG.to_string(),
        },
    };

    let mut cache = FFMPEG_RELEASE_CACHE.lock_unpoisoned();
    *cache = Some(info.clone());
    info
}

pub(crate) fn current_libavif_release() -> LibavifRelease {
    {
        let cache = LIBAVIF_RELEASE_CACHE.lock_unpoisoned();
        if let Some(info) = cache.as_ref() {
            return info.clone();
        }
    }

    let from_github = fetch_libavif_release_from_github();
    let info = match from_github {
        Some(tag) => {
            let version = semantic_version_from_tag(&tag);
            LibavifRelease { version, tag }
        }
        None => LibavifRelease {
            version: semantic_version_from_tag(LIBAVIF_VERSION),
            tag: LIBAVIF_VERSION.to_string(),
        },
    };

    let mut cache = LIBAVIF_RELEASE_CACHE.lock_unpoisoned();
    *cache = Some(info.clone());
    info
}

#[cfg(not(test))]
fn fetch_ffmpeg_release_from_github() -> Option<String> {
    use std::time::Duration;

    use reqwest::blocking::Client;
    use serde::Deserialize;

    let proxy = network_proxy::resolve_effective_proxy_once();
    let builder = Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("ffui/ffmpeg-static-updater");
    let builder = network_proxy::apply_reqwest_blocking_builder(builder, &proxy);

    let client = builder.build().ok()?;
    let resp = client
        .get("https://api.github.com/repos/eugeneware/ffmpeg-static/releases/latest")
        .send()
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    #[derive(Deserialize)]
    struct Release {
        tag_name: String,
    }

    let release: Release = resp.json().ok()?;
    Some(release.tag_name)
}

#[cfg(not(test))]
fn fetch_libavif_release_from_github() -> Option<String> {
    use std::time::Duration;

    use reqwest::blocking::Client;
    use serde::Deserialize;

    let proxy = network_proxy::resolve_effective_proxy_once();
    let builder = Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("ffui/libavif-updater");
    let builder = network_proxy::apply_reqwest_blocking_builder(builder, &proxy);

    let client = builder.build().ok()?;
    let resp = client
        .get("https://api.github.com/repos/AOMediaCodec/libavif/releases/latest")
        .send()
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    #[derive(Deserialize)]
    struct Release {
        tag_name: String,
    }

    let release: Release = resp.json().ok()?;
    Some(release.tag_name)
}

#[cfg(test)]
const fn fetch_ffmpeg_release_from_github() -> Option<String> {
    None
}

#[cfg(test)]
const fn fetch_libavif_release_from_github() -> Option<String> {
    None
}

#[allow(dead_code)]
pub(crate) fn latest_remote_version(kind: ExternalToolKind) -> Option<String> {
    match kind {
        ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe => {
            Some(current_ffmpeg_release().version)
        }
        ExternalToolKind::Avifenc => Some(current_libavif_release().version),
    }
}

pub(crate) fn default_ffmpeg_download_url() -> Result<String> {
    let release = current_ffmpeg_release();
    let tag = release.tag;

    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffmpeg-win32-x64"
        ))
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffmpeg-linux-x64"
        ))
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffmpeg-linux-arm64"
        ))
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffmpeg-darwin-x64"
        ))
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffmpeg-darwin-arm64"
        ))
    } else {
        Err(anyhow!(
            "auto-download for ffmpeg-static is not supported on this platform"
        ))
    }
}

pub(crate) fn default_ffprobe_download_url() -> Result<String> {
    let release = current_ffmpeg_release();
    let tag = release.tag;

    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffprobe-win32-x64"
        ))
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffprobe-linux-x64"
        ))
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffprobe-linux-arm64"
        ))
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffprobe-darwin-x64"
        ))
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok(format!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/{tag}/ffprobe-darwin-arm64"
        ))
    } else {
        Err(anyhow!(
            "auto-download for ffprobe-static is not supported on this platform"
        ))
    }
}

pub(crate) fn default_avifenc_zip_url() -> Result<String> {
    let release = current_libavif_release();
    let tag = release.tag;

    if cfg!(target_os = "windows") {
        Ok(format!(
            "https://github.com/AOMediaCodec/libavif/releases/download/{tag}/windows-artifacts.zip"
        ))
    } else if cfg!(target_os = "linux") {
        Ok(format!(
            "https://github.com/AOMediaCodec/libavif/releases/download/{tag}/linux-artifacts.zip"
        ))
    } else if cfg!(target_os = "macos") {
        Ok(format!(
            "https://github.com/AOMediaCodec/libavif/releases/download/{tag}/macOS-artifacts.zip"
        ))
    } else {
        Err(anyhow!(
            "auto-download for avifenc is not supported on this platform"
        ))
    }
}
