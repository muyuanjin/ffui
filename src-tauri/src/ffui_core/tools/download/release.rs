use anyhow::{Result, anyhow};

use crate::ffui_core::tools::download::net::proxy_from_env;
use crate::ffui_core::tools::types::*;

pub(crate) fn semantic_version_from_tag(tag: &str) -> String {
    let idx = tag.find(|c: char| c.is_ascii_digit()).unwrap_or(0);
    tag[idx..].to_string()
}

pub(crate) fn current_ffmpeg_release() -> FfmpegStaticRelease {
    {
        let cache = FFMPEG_RELEASE_CACHE
            .lock()
            .expect("FFMPEG_RELEASE_CACHE lock poisoned");
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

    let mut cache = FFMPEG_RELEASE_CACHE
        .lock()
        .expect("FFMPEG_RELEASE_CACHE lock poisoned");
    *cache = Some(info.clone());
    info
}

#[cfg(not(test))]
fn fetch_ffmpeg_release_from_github() -> Option<String> {
    use reqwest::Proxy;
    use reqwest::blocking::Client;
    use serde::Deserialize;
    use std::time::Duration;

    let mut builder = Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("ffui/ffmpeg-static-updater");

    if let Some(proxy_url) = proxy_from_env()
        && let Ok(proxy) = Proxy::all(&proxy_url)
    {
        builder = builder.proxy(proxy);
    }

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

#[cfg(test)]
fn fetch_ffmpeg_release_from_github() -> Option<String> {
    None
}

pub(crate) fn latest_remote_version(kind: ExternalToolKind) -> Option<String> {
    match kind {
        ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe => {
            Some(current_ffmpeg_release().version)
        }
        ExternalToolKind::Avifenc => None,
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

pub(crate) fn default_avifenc_zip_url() -> Result<&'static str> {
    if cfg!(target_os = "windows") {
        Ok("https://github.com/AOMediaCodec/libavif/releases/download/v1.3.0/windows-artifacts.zip")
    } else if cfg!(target_os = "linux") {
        Ok("https://github.com/AOMediaCodec/libavif/releases/download/v1.3.0/linux-artifacts.zip")
    } else if cfg!(target_os = "macos") {
        Ok("https://github.com/AOMediaCodec/libavif/releases/download/v1.3.0/macOS-artifacts.zip")
    } else {
        Err(anyhow!(
            "auto-download for avifenc is not supported on this platform"
        ))
    }
}
