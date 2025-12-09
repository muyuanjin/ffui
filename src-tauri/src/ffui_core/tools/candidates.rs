use super::discover::discover_candidates;
use super::probe::{detect_local_tool_version, verify_tool_binary};
use super::resolve::{
    custom_path_for, downloaded_tool_path, looks_like_bare_program_name, resolve_in_path,
    tool_binary_name,
};
use super::runtime_state::snapshot_download_state;
use super::types::{ExternalToolCandidate, ExternalToolKind};
use crate::ffui_core::settings::ExternalToolSettings;

pub fn tool_candidates(
    kind: ExternalToolKind,
    settings: &ExternalToolSettings,
) -> Vec<ExternalToolCandidate> {
    let current_status = super::status::tool_status(kind, settings);
    let current_path = current_status.resolved_path.clone();
    let runtime = snapshot_download_state(kind);

    let mut candidates: Vec<(String, String)> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut push_candidate = |path: String, source: &str| {
        if seen.insert(path.clone()) {
            candidates.push((path, source.to_string()));
        }
    };

    if let Some(custom_raw) = custom_path_for(kind, settings) {
        let expanded = if looks_like_bare_program_name(&custom_raw) {
            resolve_in_path(&custom_raw)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or(custom_raw)
        } else {
            custom_raw
        };
        push_candidate(expanded, "custom");
    }

    if !runtime.download_arch_incompatible
        && let Some(downloaded) = downloaded_tool_path(kind)
    {
        push_candidate(downloaded.to_string_lossy().into_owned(), "download");
    }

    let bin = tool_binary_name(kind).to_string();
    let path_candidate = resolve_in_path(&bin)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(bin.clone());
    push_candidate(path_candidate.clone(), "path");

    // Add additional discovered paths (env overrides, registry, indexers).
    // 这里通过 `seen` 集合与上面已经加入的 custom/download/path 做统一去重，
    // 避免 Everything SDK 把同一个 exe 再次作为 "everything" 来源插入，导致
    // 前端候选列表出现“同一路径多次重复”的情况。
    for discovered in discover_candidates(&bin, kind) {
        let s = discovered.path.to_string_lossy().into_owned();
        push_candidate(s, discovered.source);
    }

    let mut result: Vec<ExternalToolCandidate> = Vec::new();
    for (path, source) in candidates {
        if source == "path" && runtime.path_arch_incompatible {
            continue;
        }
        if verify_tool_binary(&path, kind, &source) {
            let version = detect_local_tool_version(&path, kind);
            let is_current = current_path.as_deref() == Some(path.as_str());
            result.push(ExternalToolCandidate {
                kind,
                path,
                source,
                version,
                is_current,
            });
        }
    }
    result
}
