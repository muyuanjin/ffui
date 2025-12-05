use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use super::types::*;
use crate::ffui_core::settings::ExternalToolSettings;

pub(super) fn tool_binary_name(kind: ExternalToolKind) -> &'static str {
    match kind {
        ExternalToolKind::Ffmpeg => "ffmpeg",
        ExternalToolKind::Ffprobe => "ffprobe",
        ExternalToolKind::Avifenc => "avifenc",
    }
}

pub(super) fn custom_path_for(
    kind: ExternalToolKind,
    settings: &ExternalToolSettings,
) -> Option<String> {
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

pub(super) fn tools_dir() -> Result<PathBuf> {
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

pub(super) fn downloaded_tool_filename(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

pub(super) fn downloaded_tool_path(kind: ExternalToolKind) -> Option<PathBuf> {
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
