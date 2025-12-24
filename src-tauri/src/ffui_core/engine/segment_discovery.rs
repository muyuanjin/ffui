use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub(super) fn build_legacy_video_tmp_output_path(input_path: &Path) -> Option<PathBuf> {
    let parent = input_path.parent()?;
    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = input_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp4");
    Some(parent.join(format!("{stem}.compressed.tmp.{ext}")))
}

pub(super) fn discover_segments_for_output_path(
    output_path: &Path,
    job_id: &str,
    out: &mut BTreeMap<u64, PathBuf>,
) {
    let Some(parent) = output_path.parent() else {
        return;
    };
    let Some(stem) = output_path.file_stem().and_then(|s| s.to_str()) else {
        return;
    };
    let expected_ext = output_path.extension().and_then(|s| s.to_str());
    let prefix = format!("{stem}.{job_id}.seg");
    discover_segments_in_dir(parent, &prefix, expected_ext, out);
}

pub(super) fn discover_segments_for_input_path(
    input_path: &Path,
    job_id: &str,
    out: &mut BTreeMap<u64, PathBuf>,
) {
    let Some(parent) = input_path.parent() else {
        return;
    };
    let Some(stem) = input_path.file_stem().and_then(|s| s.to_str()) else {
        return;
    };
    let prefix = format!("{stem}.compressed.{job_id}.seg");
    discover_segments_in_dir(parent, &prefix, None, out);
}

fn discover_segments_in_dir(
    dir: &Path,
    prefix: &str,
    expected_ext: Option<&str>,
    out: &mut BTreeMap<u64, PathBuf>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(v) => v,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some((idx, ext)) = parse_segment_index_and_ext(name, prefix) else {
            continue;
        };
        if let Some(expected) = expected_ext
            && !ext.eq_ignore_ascii_case(expected)
        {
            continue;
        }
        out.entry(idx).or_insert(path);
    }
}

fn parse_segment_index_and_ext(name: &str, prefix: &str) -> Option<(u64, String)> {
    if !name.starts_with(prefix) {
        return None;
    }
    let rest = &name[prefix.len()..];
    let (idx_part, ext_part) = rest.split_once(".tmp.")?;
    if idx_part.is_empty() || !idx_part.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let idx = idx_part.parse::<u64>().ok()?;
    let ext = ext_part.trim();
    if ext.is_empty() {
        return None;
    }
    Some((idx, ext.to_string()))
}
