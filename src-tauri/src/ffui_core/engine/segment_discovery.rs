use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[cfg(any(test, feature = "bench"))]
use std::cell::Cell;

#[cfg(any(test, feature = "bench"))]
thread_local! {
    static LIST_SEGMENT_CANDIDATES_CALLS: Cell<usize> = const { Cell::new(0) };
}

#[cfg(any(test, feature = "bench"))]
pub(crate) fn reset_list_segment_candidates_calls_for_tests() {
    LIST_SEGMENT_CANDIDATES_CALLS.with(|c| c.set(0));
}

#[cfg(any(test, feature = "bench"))]
pub(crate) fn list_segment_candidates_calls_for_tests() -> usize {
    LIST_SEGMENT_CANDIDATES_CALLS.with(Cell::get)
}

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
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let path = entry.path();
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

#[derive(Debug, Clone)]
pub(super) struct SegmentCandidate {
    pub prefix: String,
    pub idx: u64,
    pub ext: String,
    pub path: PathBuf,
}

pub(super) fn list_segment_candidates_in_dir(dir: &Path) -> Vec<SegmentCandidate> {
    #[cfg(any(test, feature = "bench"))]
    LIST_SEGMENT_CANDIDATES_CALLS.with(|c| c.set(c.get().saturating_add(1)));

    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut out: Vec<SegmentCandidate> = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some((prefix, idx, ext)) = parse_segment_prefix_index_and_ext(name) else {
            continue;
        };
        out.push(SegmentCandidate {
            prefix,
            idx,
            ext,
            path: entry.path(),
        });
    }
    out
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

fn parse_segment_prefix_index_and_ext(name: &str) -> Option<(String, u64, String)> {
    let (before_tmp, ext_part) = name.split_once(".tmp.")?;
    let ext = ext_part.trim();
    if ext.is_empty() {
        return None;
    }

    let mut digit_start = before_tmp.len();
    for (idx, ch) in before_tmp.char_indices().rev() {
        if ch.is_ascii_digit() {
            digit_start = idx;
            continue;
        }
        digit_start = idx + ch.len_utf8();
        break;
    }

    if digit_start >= before_tmp.len() {
        return None;
    }
    let (prefix, digits) = before_tmp.split_at(digit_start);
    if prefix.is_empty() || digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let idx = digits.parse::<u64>().ok()?;
    Some((prefix.to_string(), idx, ext.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_segment_prefix_index_and_ext_accepts_expected_format() {
        let (prefix, idx, ext) = parse_segment_prefix_index_and_ext("a.b.seg12.tmp.mp4")
            .expect("expected to parse segment filename");
        assert_eq!(prefix, "a.b.seg");
        assert_eq!(idx, 12);
        assert_eq!(ext, "mp4");
    }

    #[test]
    fn parse_segment_prefix_index_and_ext_rejects_missing_digits() {
        assert!(parse_segment_prefix_index_and_ext("a.b.seg.tmp.mp4").is_none());
    }
}
