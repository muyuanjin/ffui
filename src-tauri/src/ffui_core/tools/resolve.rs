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

#[allow(dead_code)]
pub fn resolve_tool_path(
    kind: ExternalToolKind,
    settings: &ExternalToolSettings,
) -> Result<(String, String)> {
    if let Some(custom) = custom_path_for(kind, settings) {
        // If the custom value looks like a bare program name (no path
        // separators, no spaces), try to expand it via PATH so that logs
        // and the queue UI see the same concrete executable path that the
        // OS will ultimately run. If resolution fails we fall back to the
        // original string to keep behaviour no worse than before.
        let expanded = if looks_like_bare_program_name(&custom) {
            resolve_in_path(&custom)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or(custom)
        } else {
            custom
        };
        return Ok((expanded, "custom".to_string()));
    }

    // Prefer a previously auto-downloaded binary next to the executable if it exists.
    if let Some(downloaded) = downloaded_tool_path(kind) {
        return Ok((
            downloaded.to_string_lossy().into_owned(),
            "download".to_string(),
        ));
    }

    let bin = tool_binary_name(kind).to_string();

    // When falling back to a system-provided binary, try to resolve the bare
    // program name to an absolute path via the current PATH. This keeps the
    // actual executable location visible in logs and the queue UI instead of
    // only showing a generic `ffmpeg`/`ffprobe` token. If resolution fails we
    // still return the bare name so behaviour is no worse than before.
    if let Some(resolved) = resolve_in_path(&bin) {
        return Ok((resolved.to_string_lossy().into_owned(), "path".to_string()));
    }

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

/// Best-effort resolution of a bare program name (e.g. "ffmpeg") to an
/// absolute path using the current PATH/PATHEXT configuration.
///
/// This is intentionally conservative: we only attempt expansion when the
/// input does not contain any path separators, and we require the candidate
/// to exist as a regular file. If anything looks unexpected we return None
/// so callers can fall back to the original program string.
pub(super) fn resolve_in_path(program: &str) -> Option<PathBuf> {
    use std::env;
    resolve_in_path_with_env(program, env::var_os("PATH"), env::var_os("PATHEXT"))
}

/// Heuristic check for values that look like a plain program name rather
/// than a path. This helps us avoid treating complex custom strings such
/// as `"ffmpeg -loglevel error"` or explicit `C:\\tools\\ffmpeg.exe` as
/// candidates for PATH expansion.
pub(super) fn looks_like_bare_program_name(program: &str) -> bool {
    !program.is_empty()
        && !program.contains('/')
        && !program.contains('\\')
        && !program.contains(':')
        && !program.contains(' ')
        && !program.contains('"')
        && !program.contains('\'')
}

pub(super) fn resolve_in_path_with_env(
    program: &str,
    path_var: Option<std::ffi::OsString>,
    _pathext_var: Option<std::ffi::OsString>,
) -> Option<PathBuf> {
    // Skip values that already look like explicit paths.
    if program.contains('/') || program.contains('\\') {
        return None;
    }

    let path_var = path_var?;
    let paths = std::env::split_paths(&path_var);

    #[cfg(windows)]
    let exts: Vec<String> = {
        let pathext = _pathext_var.unwrap_or_else(|| ".EXE;.BAT;.CMD;.COM".into());
        pathext
            .to_string_lossy()
            .split(';')
            .filter(|s| !s.is_empty())
            .map(|s| {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    return String::new();
                }
                let lower = trimmed.trim_start_matches('.').to_ascii_lowercase();
                format!(".{lower}")
            })
            .collect()
    };

    for dir in paths {
        #[cfg(windows)]
        {
            for ext in &exts {
                let candidate = dir.join(format!("{program}{ext}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }

        #[cfg(not(windows))]
        {
            let candidate = dir.join(program);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_in_path_ignores_explicit_paths() {
        let path = resolve_in_path("C:/tools/ffmpeg.exe");
        assert!(path.is_none());

        let unix_path = resolve_in_path("/usr/bin/ffmpeg");
        assert!(unix_path.is_none());
    }

    #[test]
    fn resolve_in_path_respects_fake_search_paths() {
        use std::fs::File;
        use std::io::Write;

        // Build a temporary directory with a dummy "ffmpeg" binary so we can
        // exercise the lookup logic without relying on the real system PATH.
        let dir = tempfile::tempdir().expect("create temp dir for PATH resolution test");
        let program_name = if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        };
        let candidate = dir.path().join(program_name);

        {
            let mut file = File::create(&candidate).expect("create fake ffmpeg binary");
            // A single newline is enough for `is_file()`; we do not execute it.
            writeln!(file, "#!/bin/sh\nexit 0").ok();
        }

        let fake_path = std::ffi::OsString::from(dir.path().as_os_str());
        let resolved = resolve_in_path_with_env("ffmpeg", Some(fake_path), Some(".EXE".into()));
        let resolved_str = resolved.unwrap().to_string_lossy().to_ascii_lowercase();
        let candidate_str = candidate.to_string_lossy().to_ascii_lowercase();
        assert_eq!(resolved_str, candidate_str);
    }
}
