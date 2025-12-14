use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::ffui_core::engine::is_video_file;

fn push_unique(out: &mut Vec<String>, seen: &mut HashSet<String>, path: &Path) {
    let s = path.to_string_lossy().to_string();
    if seen.insert(s.clone()) {
        out.push(s);
    }
}

fn list_dir_sorted(dir: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(read_dir) => read_dir.filter_map(|e| e.ok().map(|e| e.path())).collect(),
        Err(_) => Vec::new(),
    };

    // Stable order: case-insensitive lexicographic by the final path segment.
    entries.sort_by(|a, b| {
        let an = a
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let bn = b
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        an.cmp(&bn)
    });
    entries
}

fn expand_dir(dir: &Path, recursive: bool, out: &mut Vec<String>, seen: &mut HashSet<String>) {
    for path in list_dir_sorted(dir) {
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        let file_type = meta.file_type();
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if recursive {
                expand_dir(&path, recursive, out, seen);
            }
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        if is_video_file(&path) {
            push_unique(out, seen, &path);
        }
    }
}

/// Expand a list of user-provided input paths (files and directories) into an
/// ordered, de-duplicated list of transcodable video file paths.
///
/// Ordering rules:
/// - Input paths are processed in the provided order.
/// - Directories are expanded in a stable, deterministic order (case-insensitive
///   lexicographic by entry name) so results are predictable across runs.
pub(crate) fn expand_manual_job_inputs(paths: &[String], recursive: bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for raw in paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = PathBuf::from(trimmed);
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        let file_type = meta.file_type();
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            expand_dir(&path, recursive, &mut out, &mut seen);
            continue;
        }

        if file_type.is_file() && is_video_file(&path) {
            push_unique(&mut out, &mut seen, &path);
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::expand_manual_job_inputs;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn expands_directories_in_stable_name_order_and_filters_non_video() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();

        fs::write(root.join("b.txt"), b"no").expect("write b.txt");
        fs::write(root.join("c.mkv"), b"yes").expect("write c.mkv");
        fs::write(root.join("a.mp4"), b"yes").expect("write a.mp4");

        let paths = vec![root.to_string_lossy().to_string()];
        let expanded = expand_manual_job_inputs(&paths, true);

        assert_eq!(expanded.len(), 2);
        assert!(
            expanded[0].ends_with("a.mp4"),
            "expected a.mp4 first: {expanded:?}"
        );
        assert!(
            expanded[1].ends_with("c.mkv"),
            "expected c.mkv second: {expanded:?}"
        );
    }

    #[test]
    fn preserves_input_order_for_multiple_files() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();

        let first = root.join("first.mp4");
        let second = root.join("second.mkv");
        fs::write(&first, b"yes").expect("write first");
        fs::write(&second, b"yes").expect("write second");

        let paths = vec![
            second.to_string_lossy().to_string(),
            first.to_string_lossy().to_string(),
        ];

        let expanded = expand_manual_job_inputs(&paths, true);
        assert_eq!(expanded.len(), 2);
        assert!(expanded[0].ends_with("second.mkv"));
        assert!(expanded[1].ends_with("first.mp4"));
    }
}
