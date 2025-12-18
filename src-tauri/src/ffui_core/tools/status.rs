use std::collections::HashSet;

use super::discover::discover_candidates;
use super::probe::{
    detect_local_tool_version,
    verify_tool_binary,
};
use super::resolve::{
    custom_path_for,
    downloaded_tool_path,
    resolve_in_path,
    tool_binary_name,
};
use super::runtime_state::{
    cached_ffmpeg_release_version,
    cached_libavif_release_version,
    last_tool_download_metadata,
    snapshot_download_state,
};
use super::types::*;
use crate::ffui_core::settings::ExternalToolSettings;

fn parse_version_tuple(input: &str) -> Option<(u64, u64, u64)> {
    let normalized = input.trim().trim_start_matches('v');
    let mut it = normalized.split('.').map(str::trim);
    let major = it.next()?.parse::<u64>().ok()?;
    let minor = it.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = it.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

fn version_is_newer(candidate: &str, baseline: &str) -> bool {
    match (
        parse_version_tuple(candidate),
        parse_version_tuple(baseline),
    ) {
        (Some(candidate), Some(baseline)) => candidate > baseline,
        (Some(_), None) => true,
        _ => false,
    }
}

fn extract_semver_like(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let start = trimmed.find(|c: char| c.is_ascii_digit())?;
    let mut end = start;
    for (idx, ch) in trimmed[start..].char_indices() {
        if ch.is_ascii_digit() || ch == '.' {
            end = start + idx + ch.len_utf8();
            continue;
        }
        break;
    }
    if end <= start {
        return None;
    }
    Some(trimmed[start..end].to_string())
}

fn extract_version_tuple(input: &str) -> Option<(u64, u64, u64)> {
    let semver = extract_semver_like(input)?;
    parse_version_tuple(&semver)
}

pub(super) fn should_mark_update_available(
    source: &str,
    local_version: Option<&str>,
    remote_version: Option<&str>,
) -> bool {
    let _ = source;
    match (local_version, remote_version) {
        (Some(local), Some(remote)) => {
            match (extract_version_tuple(local), extract_version_tuple(remote)) {
                (Some(local_t), Some(remote_t)) => remote_t > local_t,
                _ => !local.contains(remote),
            }
        }
        _ => false,
    }
}

pub(super) fn effective_remote_version_for(kind: ExternalToolKind) -> Option<String> {
    match kind {
        ExternalToolKind::Ffmpeg | ExternalToolKind::Ffprobe => {
            // Remote version checks are only refreshed asynchronously (e.g. from
            // Settings → Tools) and MUST NOT happen on this synchronous code
            // path. We only reuse the latest in-process snapshot here.
            if let Some(latest) = cached_ffmpeg_release_version() {
                return Some(latest);
            }
            let fallback = FFMPEG_STATIC_VERSION;
            let persisted_version = last_tool_download_metadata(kind).and_then(|(_url, v, _tag)| v);
            let remote = match persisted_version {
                Some(v) if version_is_newer(v.as_str(), fallback) => v,
                None => fallback.to_string(),
                Some(_) => fallback.to_string(),
            };
            Some(remote)
        }
        ExternalToolKind::Avifenc => {
            if let Some(latest) = cached_libavif_release_version() {
                return Some(latest);
            }
            Some(LIBAVIF_VERSION.to_string())
        }
    }
}

pub fn tool_status(kind: ExternalToolKind, settings: &ExternalToolSettings) -> ExternalToolStatus {
    let runtime = snapshot_download_state(kind);
    let mut resolved_path: Option<String> = None;
    let mut source: Option<String> = None;
    let mut version: Option<String> = None;

    fn push_candidate(
        seen: &mut HashSet<String>,
        candidates: &mut Vec<(String, String)>,
        path: String,
        source: &str,
    ) {
        if seen.insert(path.clone()) {
            candidates.push((path, source.to_string()));
        }
    }

    let mut candidates: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    if let Some(custom_raw) = custom_path_for(kind, settings) {
        let expanded = if super::resolve::looks_like_bare_program_name(&custom_raw) {
            resolve_in_path(&custom_raw)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or(custom_raw)
        } else {
            custom_raw
        };
        push_candidate(&mut seen, &mut candidates, expanded, "custom");
    }

    if !runtime.download_arch_incompatible
        && let Some(downloaded) = downloaded_tool_path(kind)
    {
        push_candidate(
            &mut seen,
            &mut candidates,
            downloaded.to_string_lossy().into_owned(),
            "download",
        );
    }

    let bin = tool_binary_name(kind).to_string();
    let path_candidate = resolve_in_path(&bin)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| bin.clone());
    push_candidate(&mut seen, &mut candidates, path_candidate.clone(), "path");

    // Fast path: custom/download/PATH candidates are authoritative. Only do
    // secondary discovery (env/registry/indexers) if these candidates fail,
    // so startup refresh does not pay for scans it will never use.
    for (path, src) in candidates.iter() {
        if src == "path" && runtime.path_arch_incompatible {
            continue;
        }
        if verify_tool_binary(path, kind, src) {
            version = detect_local_tool_version(path, kind);
            resolved_path = Some(path.clone());
            source = Some(src.clone());
            break;
        }
    }

    if resolved_path.is_none() {
        let discovered_start = candidates.len();
        for discovered in discover_candidates(&bin, kind) {
            let s = discovered.path.to_string_lossy().into_owned();
            push_candidate(&mut seen, &mut candidates, s, discovered.source);
        }

        for (path, src) in candidates[discovered_start..].iter() {
            if src == "path" && runtime.path_arch_incompatible {
                continue;
            }
            if verify_tool_binary(path, kind, src) {
                version = detect_local_tool_version(path, kind);
                resolved_path = Some(path.clone());
                source = Some(src.clone());
                break;
            }
        }
    }

    // 如果最终找到了可用的可执行文件，则说明当前会话下已经存在一条健康路径。
    // 此时应当把之前为“坏路径”（例如架构不匹配的 PATH / Prefetch 伪文件）
    // 记录的错误消息从对前端暴露的状态中清理掉，避免出现“工具已就绪但仍显示致命错误”的
    // 矛盾提示。运行时内部仍保留架构不兼容标记，以便后续探测时跳过这些坏候选。
    let mut runtime_for_status = runtime.clone();
    if resolved_path.is_some() {
        runtime_for_status.last_error = None;
    }

    let remote_version = effective_remote_version_for(kind);
    let update_available = match (&source, &version, &remote_version) {
        (Some(source), version, remote) => {
            should_mark_update_available(source, version.as_deref(), remote.as_deref())
        }
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
        last_download_error: runtime_for_status.last_error,
        last_download_message: runtime.last_message,
    }
}
