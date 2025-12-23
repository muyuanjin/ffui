use std::collections::HashSet;
use std::fs;
use std::path::{
    Path,
    PathBuf,
};

use anyhow::{
    Context,
    Result,
};

pub(crate) fn previews_root_dir_best_effort() -> Result<PathBuf> {
    crate::ffui_core::previews_dir()
}

pub(crate) fn referenced_preview_filenames(
    paths: impl IntoIterator<Item = String>,
) -> HashSet<String> {
    let mut out = HashSet::new();
    for raw in paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let p = Path::new(trimmed);
        if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
            out.insert(name.to_string());
        }
    }
    out
}

pub(crate) fn cleanup_unreferenced_previews(
    previews_root: &Path,
    referenced_filenames: &HashSet<String>,
) -> Result<usize> {
    if !previews_root.exists() {
        return Ok(0);
    }

    let mut deleted = 0usize;

    for entry in fs::read_dir(previews_root)
        .with_context(|| format!("read_dir failed for {}", previews_root.display()))?
    {
        let entry = entry?;
        let path = entry.path();

        // Never touch nested caches; those have their own policies.
        if path.is_dir() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if referenced_filenames.contains(name) {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase());
        if !matches!(ext.as_deref(), Some("jpg" | "jpeg" | "png" | "webp")) {
            continue;
        }

        if fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }

    Ok(deleted)
}

#[cfg(test)]
mod tests;
