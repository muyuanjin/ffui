use anyhow::{Result, anyhow};

#[cfg(not(test))]
use super::release_http::{
    resolve_ffmpeg_release_from_github, resolve_libavif_release_from_github,
    resolve_release_from_github_checked,
};
#[cfg(test)]
use super::release_resolver::pinned_info;
use super::release_resolver::{FFMPEG_PROJECT, LIBAVIF_PROJECT, ReleaseResolveInfo};
use crate::ffui_core::tools::types::{
    ExternalToolKind, FFMPEG_RELEASE_CACHE, FfmpegStaticRelease, LIBAVIF_RELEASE_CACHE,
    LibavifRelease,
};
use crate::sync_ext::MutexExt;

pub(crate) use super::release_resolver::semantic_version_from_tag;

#[cfg(test)]
fn resolve_ffmpeg_release_from_github() -> ReleaseResolveInfo {
    pinned_info(FFMPEG_PROJECT, None, None)
}

#[cfg(test)]
fn resolve_libavif_release_from_github() -> ReleaseResolveInfo {
    pinned_info(LIBAVIF_PROJECT, None, None)
}

fn cache_ffmpeg_release(info: &ReleaseResolveInfo) {
    if !info.cacheable() {
        return;
    }
    let mut cache = FFMPEG_RELEASE_CACHE.lock_unpoisoned();
    *cache = Some(FfmpegStaticRelease {
        version: info.version.clone(),
        tag: info.tag.clone(),
    });
}

fn cache_libavif_release(info: &ReleaseResolveInfo) {
    if !info.cacheable() {
        return;
    }
    let mut cache = LIBAVIF_RELEASE_CACHE.lock_unpoisoned();
    *cache = Some(LibavifRelease {
        version: info.version.clone(),
        tag: info.tag.clone(),
    });
}

/// Best-effort remote check against GitHub Releases.
///
/// Returns None when all remote sources fail. Successful remote checks update
/// the in-process cache so later status snapshots can reuse the latest version
/// without repeating network work.
pub(crate) fn try_refresh_ffmpeg_release_from_github() -> Option<ReleaseResolveInfo> {
    let info = resolve_ffmpeg_release_from_github();
    if !info.cacheable() {
        return None;
    }
    cache_ffmpeg_release(&info);
    Some(info)
}

pub(crate) fn try_refresh_libavif_release_from_github() -> Option<ReleaseResolveInfo> {
    let info = resolve_libavif_release_from_github();
    if !info.cacheable() {
        return None;
    }
    cache_libavif_release(&info);
    Some(info)
}

pub(crate) fn current_ffmpeg_release() -> FfmpegStaticRelease {
    {
        let cache = FFMPEG_RELEASE_CACHE.lock_unpoisoned();
        if let Some(info) = cache.as_ref() {
            return info.clone();
        }
    }

    let resolved = resolve_ffmpeg_release_from_github();
    let cacheable = resolved.cacheable();
    let info = FfmpegStaticRelease {
        version: resolved.version,
        tag: resolved.tag,
    };

    if cacheable {
        let mut cache = FFMPEG_RELEASE_CACHE.lock_unpoisoned();
        *cache = Some(info.clone());
    }
    info
}

pub(crate) fn current_libavif_release() -> LibavifRelease {
    {
        let cache = LIBAVIF_RELEASE_CACHE.lock_unpoisoned();
        if let Some(info) = cache.as_ref() {
            return info.clone();
        }
    }

    let resolved = resolve_libavif_release_from_github();
    let cacheable = resolved.cacheable();
    let info = LibavifRelease {
        version: resolved.version,
        tag: resolved.tag,
    };

    if cacheable {
        let mut cache = LIBAVIF_RELEASE_CACHE.lock_unpoisoned();
        *cache = Some(info.clone());
    }
    info
}

#[cfg(not(test))]
pub(crate) fn refresh_ffmpeg_release_from_github_checked() -> Result<ReleaseResolveInfo> {
    let info = resolve_release_from_github_checked(FFMPEG_PROJECT)?;
    cache_ffmpeg_release(&info);
    Ok(info)
}

#[cfg(not(test))]
pub(crate) fn refresh_libavif_release_from_github_checked() -> Result<ReleaseResolveInfo> {
    let info = resolve_release_from_github_checked(LIBAVIF_PROJECT)?;
    cache_libavif_release(&info);
    Ok(info)
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
    let tag = current_ffmpeg_release().tag;

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
    let tag = current_ffmpeg_release().tag;

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
    let tag = current_libavif_release().tag;

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
