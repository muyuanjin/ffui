use std::path::PathBuf;

use anyhow::{Result, anyhow};

use super::extract::extract_avifenc_from_zip;
use super::net::{
    download_bytes_with_reqwest, download_file_with_aria2c, download_file_with_reqwest,
};
use super::release::{
    current_ffmpeg_release, default_avifenc_zip_url, default_ffmpeg_download_url,
    default_ffprobe_download_url, latest_remote_version,
};
use crate::ffui_core::settings::ExternalToolSettings;
use crate::ffui_core::tools::probe::{
    detect_local_tool_version, should_mark_update_available, verify_tool_binary,
};
use crate::ffui_core::tools::resolve::{
    downloaded_tool_filename, resolve_tool_path, tool_binary_name, tools_dir,
};
use crate::ffui_core::tools::runtime_state::{
    mark_download_error, mark_download_finished, mark_download_progress, mark_download_started,
    record_last_tool_download, snapshot_download_state,
};
use crate::ffui_core::tools::types::*;

fn download_tool_binary(kind: ExternalToolKind) -> Result<PathBuf> {
    mark_download_started(
        kind,
        format!("starting auto-download for {}", tool_binary_name(kind)),
    );

    let result = match kind {
        ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe => {
            let url = match kind {
                ExternalToolKind::Ffmpeg => default_ffmpeg_download_url()?,
                ExternalToolKind::Ffprobe => default_ffprobe_download_url()?,
                _ => unreachable!(),
            };

            let release = current_ffmpeg_release();
            record_last_tool_download(kind, url.clone(), Some(release.version), Some(release.tag));

            let dir = tools_dir()?;
            let filename = downloaded_tool_filename(tool_binary_name(kind));
            let dest_path = dir.join(&filename);

            if super::net::aria2c_available() {
                if let Err(err) = download_file_with_aria2c(&url, &dest_path) {
                    eprintln!(
                        "aria2c download failed for {filename} ({url}): {err:#}; falling back to built-in HTTP client"
                    );
                    download_file_with_reqwest(&url, &dest_path, |downloaded, total| {
                        if let Some(total) = total {
                            let pct = (downloaded as f32 / total as f32) * 100.0;
                            mark_download_progress(kind, pct);
                        }
                    })?;
                }
            } else {
                download_file_with_reqwest(&url, &dest_path, |downloaded, total| {
                    if let Some(total) = total {
                        let pct = (downloaded as f32 / total as f32) * 100.0;
                        mark_download_progress(kind, pct);
                    }
                })?;
            }

            Ok(dest_path)
        }
        ExternalToolKind::Avifenc => {
            let url = default_avifenc_zip_url()?;
            let bytes = download_bytes_with_reqwest(url, |downloaded, total| {
                if let Some(total) = total {
                    let pct = (downloaded as f32 / total as f32) * 100.0;
                    mark_download_progress(kind, pct);
                }
            })?;

            let dir = tools_dir()?;
            let filename = downloaded_tool_filename(tool_binary_name(kind));
            let dest_path = dir.join(&filename);

            extract_avifenc_from_zip(&bytes, &dest_path)?;
            record_last_tool_download(
                kind,
                url.to_string(),
                Some(LIBAVIF_VERSION.to_string()),
                Some(LIBAVIF_VERSION.to_string()),
            );
            Ok(dest_path)
        }
    };

    match result {
        Ok(path) => {
            mark_download_finished(
                kind,
                format!(
                    "auto-download completed for {} (path: {})",
                    tool_binary_name(kind),
                    path.display()
                ),
            );
            Ok(path)
        }
        Err(err) => {
            mark_download_error(
                kind,
                format!(
                    "auto-download for {} failed: {err:#}",
                    tool_binary_name(kind)
                ),
            );
            Err(err)
        }
    }
}

pub(crate) fn ensure_tool_available(
    kind: ExternalToolKind,
    settings: &ExternalToolSettings,
) -> Result<(String, String, bool)> {
    let (mut path, mut source) = resolve_tool_path(kind, settings)?;
    let runtime_state = snapshot_download_state(kind);
    let mut did_download = false;

    if source == "download" && runtime_state.download_arch_incompatible {
        return Err(anyhow!(
            "{} auto-downloaded binary at '{}' cannot be executed on this system; \
请在\"软件设置 → 外部工具\"中关闭自动下载，并手动指定一份可用的 {} 路径。",
            tool_binary_name(kind),
            path,
            tool_binary_name(kind),
        ));
    }

    if source == "path" && runtime_state.path_arch_incompatible && !settings.auto_download {
        return Err(anyhow!(
            "system-provided {} at '{}' cannot be executed on this system; \
请在\"软件设置 → 外部工具\"中关闭自动下载，或在设置中指定一份可用的 {} 路径。",
            tool_binary_name(kind),
            path,
            tool_binary_name(kind),
        ));
    }

    let mut verified = verify_tool_binary(&path, kind, &source);

    if settings.auto_download && !verified && source == "path" {
        match download_tool_binary(kind) {
            Ok(downloaded) => {
                path = downloaded.to_string_lossy().into_owned();
                source = "download".to_string();
                did_download = true;
                verified = verify_tool_binary(&path, kind, &source);
            }
            Err(err) => {
                return Err(anyhow!(
                    "{} not found and auto-download failed: {err}",
                    tool_binary_name(kind)
                ));
            }
        }
    }

    if !verified {
        return Err(anyhow!(
            "{} does not appear to be available at '{}'. Install it or configure a valid custom path.",
            tool_binary_name(kind),
            path
        ));
    }

    let local_version = detect_local_tool_version(&path, kind);
    let remote_version = if settings.auto_update {
        latest_remote_version(kind)
    } else {
        None
    };
    if should_mark_update_available(
        settings.auto_update,
        &source,
        local_version.as_deref(),
        remote_version.as_deref(),
    ) && let Ok(downloaded) = download_tool_binary(kind)
    {
        let new_path = downloaded.to_string_lossy().into_owned();
        if verify_tool_binary(&new_path, kind, "download") {
            path = new_path;
            source = "download".to_string();
            did_download = true;
        }
    }

    Ok((path, source, did_download))
}
