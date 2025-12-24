use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{
    AtomicBool,
    Ordering,
};
use std::thread;
use std::time::Duration;

use anyhow::{
    Context,
    Result,
    anyhow,
};

use super::extract::extract_avifenc_from_zip;
use super::net::{
    download_bytes_with_reqwest,
    download_file_with_aria2c,
    download_file_with_reqwest,
};
use super::release::{
    current_ffmpeg_release,
    default_avifenc_zip_url,
    default_ffmpeg_download_url,
    default_ffprobe_download_url,
    semantic_version_from_tag,
};
use crate::ffui_core::settings::ExternalToolSettings;
use crate::ffui_core::tools::discover::discover_candidates;
use crate::ffui_core::tools::probe::verify_tool_binary;
use crate::ffui_core::tools::resolve::{
    custom_path_for,
    downloaded_tool_filename,
    downloaded_tool_path,
    looks_like_bare_program_name,
    resolve_in_path,
    tool_binary_name,
    tools_dir,
};
use crate::ffui_core::tools::runtime_state::{
    mark_download_error,
    mark_download_finished,
    mark_download_progress,
    mark_download_started,
    record_last_tool_download,
    snapshot_download_state,
};
use crate::ffui_core::tools::types::*;

/// For download flows that do not naturally surface per-chunk progress
/// (notably aria2c), poll the temporary download file size and emit progress
/// events so the frontend sees determinate progress instead of a long-lived
/// indeterminate spinner.
pub(crate) fn spawn_download_size_probe(
    kind: ExternalToolKind,
    tmp_path: PathBuf,
    total: Option<u64>,
) -> (Arc<AtomicBool>, Option<thread::JoinHandle<()>>) {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let handle = thread::Builder::new()
        .name("ffui-tool-progress-probe".to_string())
        .spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                if let Ok(meta) = std::fs::metadata(&tmp_path) {
                    mark_download_progress(kind, meta.len(), total);
                }
                thread::park_timeout(Duration::from_millis(250));
            }
        })
        .ok();
    if handle.is_none() {
        eprintln!("failed to spawn progress probe thread");
    }
    (stop, handle)
}

fn download_tool_binary(kind: ExternalToolKind) -> Result<PathBuf> {
    mark_download_started(
        kind,
        format!("starting auto-download for {}", tool_binary_name(kind)),
    );

    let result = match kind {
        ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe => {
            let url = if matches!(kind, ExternalToolKind::Ffmpeg) {
                default_ffmpeg_download_url()?
            } else {
                default_ffprobe_download_url()?
            };

            let release = current_ffmpeg_release();
            record_last_tool_download(kind, url.clone(), Some(release.version), Some(release.tag));

            let dir = tools_dir()?;
            let filename = downloaded_tool_filename(tool_binary_name(kind));
            let dest_path = dir.join(&filename);
            let tmp_path = dir.join(format!("{filename}.tmp"));
            let mut probe: Option<(Arc<AtomicBool>, Option<thread::JoinHandle<()>>)> = None;

            if super::net::aria2c_available() {
                // Try to fetch a content length hint to expose determinate progress early.
                let total_hint = super::net::content_length_head(&url);
                probe = Some(spawn_download_size_probe(
                    kind,
                    tmp_path.clone(),
                    total_hint,
                ));
                // Download to a temporary file first to avoid surfacing a
                // truncated/corrupted binary under the final name on crashes.
                if let Err(err) = download_file_with_aria2c(&url, &tmp_path) {
                    eprintln!(
                        "aria2c download failed for {filename} ({url}): {err:#}; falling back to built-in HTTP client"
                    );
                    download_file_with_reqwest(&url, &tmp_path, |downloaded, total| {
                        mark_download_progress(kind, downloaded, total);
                    })?;
                }
            } else {
                download_file_with_reqwest(&url, &tmp_path, |downloaded, total| {
                    mark_download_progress(kind, downloaded, total);
                })?;
            }
            if let Some((stop, handle)) = probe {
                stop.store(true, Ordering::Relaxed);
                if let Some(handle) = handle {
                    let _ = handle.join();
                }
            }

            // On Windows we must verify using an executable-looking path
            // (suffix .exe), so perform verification _after_ moving into
            // place. To avoid losing a good existing binary on failure, keep
            // a best-effort backup and restore it if verification fails.
            let mut backup_path: Option<PathBuf> = None;
            if dest_path.exists() {
                let candidate = dest_path.with_extension("bak");
                let _ = std::fs::remove_file(&candidate);
                if std::fs::rename(&dest_path, &candidate).is_ok() {
                    backup_path = Some(candidate);
                } else {
                    // Fallback: remove existing file so the new download can be placed.
                    let _ = std::fs::remove_file(&dest_path);
                }
            }

            std::fs::rename(&tmp_path, &dest_path).with_context(|| {
                format!(
                    "failed to move freshly downloaded {tool} into place: {} -> {}",
                    tmp_path.display(),
                    dest_path.display(),
                    tool = tool_binary_name(kind)
                )
            })?;

            let dest_str = dest_path.to_string_lossy().into_owned();
            if !verify_tool_binary(&dest_str, kind, "download") {
                let _ = std::fs::remove_file(&dest_path);
                if let Some(backup) = &backup_path {
                    let _ = std::fs::rename(backup, &dest_path);
                }
                return Err(anyhow!(
                    "downloaded {tool} binary failed verification after install; refusing to keep it",
                    tool = tool_binary_name(kind)
                ));
            }

            // Verified successfully; clean up any backup.
            if let Some(backup) = &backup_path {
                let _ = std::fs::remove_file(backup);
            }

            // Ensure progress reaches 100% with concrete byte counts even when
            // aria2c is used (which does not emit per-chunk callbacks).
            if let Ok(meta) = std::fs::metadata(&dest_path) {
                mark_download_progress(kind, meta.len(), Some(meta.len()));
            }

            Ok(dest_path)
        }
        ExternalToolKind::Avifenc => {
            let url = default_avifenc_zip_url()?;
            let bytes = download_bytes_with_reqwest(&url, |downloaded, total| {
                mark_download_progress(kind, downloaded, total);
            })?;

            let dir = tools_dir()?;
            let filename = downloaded_tool_filename(tool_binary_name(kind));
            let dest_path = dir.join(&filename);
            let tmp_path = dir.join(format!("{filename}.tmp"));

            // Extract into a temporary path first to avoid leaving a partial
            // binary with the final name when extraction is interrupted.
            extract_avifenc_from_zip(&bytes, &tmp_path)?;

            let mut backup_path: Option<PathBuf> = None;
            if dest_path.exists() {
                let candidate = dest_path.with_extension("bak");
                let _ = std::fs::remove_file(&candidate);
                if std::fs::rename(&dest_path, &candidate).is_ok() {
                    backup_path = Some(candidate);
                } else {
                    let _ = std::fs::remove_file(&dest_path);
                }
            }

            std::fs::rename(&tmp_path, &dest_path).with_context(|| {
                format!(
                    "failed to move freshly extracted avifenc into place: {} -> {}",
                    tmp_path.display(),
                    dest_path.display()
                )
            })?;

            let dest_str = dest_path.to_string_lossy().into_owned();
            if !verify_tool_binary(&dest_str, kind, "download") {
                let _ = std::fs::remove_file(&dest_path);
                if let Some(backup) = &backup_path {
                    let _ = std::fs::rename(backup, &dest_path);
                }
                return Err(anyhow!(
                    "extracted avifenc failed verification after install; refusing to keep it"
                ));
            }

            if let Some(backup) = &backup_path {
                let _ = std::fs::remove_file(backup);
            }
            record_last_tool_download(
                kind,
                url,
                Some(semantic_version_from_tag(LIBAVIF_VERSION)),
                Some(LIBAVIF_VERSION.to_string()),
            );

            if let Ok(meta) = std::fs::metadata(&dest_path) {
                mark_download_progress(kind, meta.len(), Some(meta.len()));
            }
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

/// Force a download/update for the given external tool kind.
///
/// This bypasses the `ensure_tool_available` auto-download/update decision
/// logic and is intended for explicit user actions (manual “下载/更新”按钮或
/// 自动更新开关触发的后台更新)。
pub(crate) fn force_download_tool_binary(kind: ExternalToolKind) -> Result<PathBuf> {
    download_tool_binary(kind)
}

pub(crate) fn ensure_tool_available(
    kind: ExternalToolKind,
    settings: &ExternalToolSettings,
) -> Result<(String, String, bool)> {
    // Core strategy:
    // 1) Build a candidate chain in priority order: custom > downloaded > PATH.
    // 2) For each candidate, require a successful `-version` probe before treating it as usable.
    // 3) If a higher-priority candidate fails verification, automatically fall back to the next one
    //    instead of immediately failing, so that a broken auto-downloaded binary can never "poison" an
    //    otherwise healthy PATH configuration.
    //
    // Auto-download remains constrained to the PATH branch only, and only
    // when enabled in settings. This preserves the previous "no download
    // loop" behaviour while adding PATH fallback for damaged downloads.
    let runtime_state = snapshot_download_state(kind);
    let mut did_download = false;

    let tool = tool_binary_name(kind);

    // Build candidate paths in priority order. Each entry is (path, source).
    let mut candidates: Vec<(String, String)> = Vec::new();

    // 1) Explicit custom path from settings (highest priority).
    if let Some(custom_raw) = custom_path_for(kind, settings) {
        // Keep behaviour consistent with resolve_tool_path: if the custom
        // value looks like a bare program name (e.g. "ffmpeg"), try to expand
        // it via PATH so logs and job commands see the same concrete path.
        let expanded = if looks_like_bare_program_name(&custom_raw) {
            resolve_in_path(&custom_raw)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or(custom_raw)
        } else {
            custom_raw
        };
        candidates.push((expanded, "custom".to_string()));
    }

    // 2) Auto-downloaded binary next to the executable, unless we already know it cannot be executed on
    //    this system (architecture mismatch).
    if runtime_state.download_arch_incompatible {
        // Known incompatible for this session; skip the downloaded candidate
        // so that PATH/custom sources can still be used.
    } else if let Some(downloaded) = downloaded_tool_path(kind) {
        candidates.push((
            downloaded.to_string_lossy().into_owned(),
            "download".to_string(),
        ));
    }

    // 3) System PATH as the ultimate fallback. We still try to resolve the bare program name into an
    //    absolute path when possible so that logs and queue commands can show where the binary actually
    //    lives.
    let bin = tool_binary_name(kind).to_string();
    let path_candidate = resolve_in_path(&bin)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(bin.clone());
    candidates.push((path_candidate.clone(), "path".to_string()));

    // Enrich with additional discovered locations (env/registry/indexers).
    let mut seen = std::collections::HashSet::new();
    seen.insert(path_candidate);
    for discovered in discover_candidates(&bin, kind) {
        let s = discovered.path.to_string_lossy().into_owned();
        if seen.insert(s.clone()) {
            candidates.push((s, discovered.source.to_string()));
        }
    }

    // Walk candidates in order, looking for the first one that passes the
    // verification probe. For PATH we are allowed to auto-download once
    // (when enabled) to migrate to a pinned static binary.
    let mut last_error: Option<String> = None;

    for (path, source) in candidates {
        // When we already know the PATH-resolved binary is architecturally
        // incompatible and auto-download is disabled, surface a clear error
        // instead of re-probing the same broken executable.
        if source == "path" && runtime_state.path_arch_incompatible && !settings.auto_download {
            last_error = Some(format!(
                "system-provided {tool} at '{path}' cannot be executed on this system; \
请在\"软件设置 → 外部工具\"中指定一份可用的 {tool} 路径。",
            ));
            continue;
        }

        let verified = verify_tool_binary(&path, kind, &source);
        if verified {
            return Ok((path, source, did_download));
        }

        // If PATH fails verification and auto-download is enabled, attempt a
        // one-off download of the pinned static binary, but only when we do
        // not already know the downloaded binary is architecturally broken.
        if source == "path" && settings.auto_download && !runtime_state.download_arch_incompatible {
            match download_tool_binary(kind) {
                Ok(downloaded) => {
                    let downloaded_path = downloaded.to_string_lossy().into_owned();
                    let downloaded_source = "download".to_string();
                    did_download = true;
                    if verify_tool_binary(&downloaded_path, kind, &downloaded_source) {
                        return Ok((downloaded_path, downloaded_source, did_download));
                    }
                    last_error = Some(format!(
                        "{tool} auto-downloaded binary at '{downloaded_path}' could not be \
executed. 请在\"软件设置 → 外部工具\"中手动指定一份可用的 {tool} 路径。",
                    ));
                }
                Err(err) => {
                    last_error = Some(format!(
                        "{tool} not found on PATH and auto-download failed: {err}",
                    ));
                }
            }
            // After a PATH + auto-download attempt there are no higher
            // priority candidates left to try, so we can break early.
            break;
        }

        // For custom/download candidates (and PATH when auto-download is
        // disabled), remember a generic "not available" error while still
        // allowing lower-priority candidates to be tried.
        last_error = Some(format!(
            "{tool} does not appear to be available at '{path}'. Install it or configure a valid custom path.",
        ));
    }

    Err(anyhow!(last_error.unwrap_or_else(|| {
        format!(
            "{tool} does not appear to be available on this system. \
请在\"软件设置 → 外部工具\"中配置一份可用的 {tool} 路径，或确保它在系统 PATH 中可见。"
        )
    })))
}
