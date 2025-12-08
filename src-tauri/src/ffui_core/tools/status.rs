use super::resolve::{custom_path_for, downloaded_tool_path, resolve_in_path, tool_binary_name};
use super::runtime_state::{snapshot_download_state, last_tool_download_metadata};
use super::types::*;
use super::probe::{verify_tool_binary, detect_local_tool_version};
use crate::ffui_core::settings::ExternalToolSettings;

pub(super) fn should_mark_update_available(
    source: &str,
    local_version: Option<&str>,
    remote_version: Option<&str>,
) -> bool {
    let _ = source;
    match (local_version, remote_version) {
        (Some(local), Some(remote)) => !local.contains(remote),
        _ => false,
    }
}

pub(super) fn effective_remote_version_for(kind: ExternalToolKind) -> Option<String> {
    match kind {
        ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe => {
            if let Some((_url, version, _tag)) = last_tool_download_metadata(kind)
                && let Some(v) = version
            { return Some(v); }
            Some(FFMPEG_STATIC_VERSION.to_string())
        }
        ExternalToolKind::Avifenc => None,
    }
}

pub fn tool_status(kind: ExternalToolKind, settings: &ExternalToolSettings) -> ExternalToolStatus {
    let runtime = snapshot_download_state(kind);
    let mut resolved_path: Option<String> = None;
    let mut source: Option<String> = None;
    let mut version: Option<String> = None;

    let mut candidates: Vec<(String, String)> = Vec::new();

    if let Some(custom_raw) = custom_path_for(kind, settings) {
        let expanded = if super::resolve::looks_like_bare_program_name(&custom_raw) {
            resolve_in_path(&custom_raw).map(|p| p.to_string_lossy().into_owned()).unwrap_or(custom_raw)
        } else { custom_raw };
        candidates.push((expanded, "custom".to_string()));
    }

    if !runtime.download_arch_incompatible {
        if let Some(downloaded) = downloaded_tool_path(kind) {
            candidates.push((downloaded.to_string_lossy().into_owned(), "download".to_string()));
        }
    }

    let bin = tool_binary_name(kind).to_string();
    let path_candidate = resolve_in_path(&bin).map(|p| p.to_string_lossy().into_owned()).unwrap_or(bin);
    candidates.push((path_candidate, "path".to_string()));

    for (path, src) in candidates {
        if src == "path" && runtime.path_arch_incompatible { continue; }
        if verify_tool_binary(&path, kind, &src) {
            version = detect_local_tool_version(&path, kind);
            resolved_path = Some(path);
            source = Some(src);
            break;
        }
    }

    let remote_version = effective_remote_version_for(kind);
    let update_available = match (&source, &version, &remote_version) {
        (Some(source), version, remote) => should_mark_update_available(source, version.as_deref(), remote.as_deref()),
        (None, _, _) => false,
    };

    ExternalToolStatus {
        kind,
        resolved_path,
        source,
        version,
        remote_version,
        update_available,
        auto_download_enabled: settings.auto_download,
        auto_update_enabled: settings.auto_update,
        download_in_progress: runtime.in_progress,
        download_progress: runtime.progress,
        downloaded_bytes: runtime.downloaded_bytes,
        total_bytes: runtime.total_bytes,
        bytes_per_second: runtime.bytes_per_second,
        last_download_error: runtime.last_error,
        last_download_message: runtime.last_message,
    }
}

