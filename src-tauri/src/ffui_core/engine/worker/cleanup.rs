use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use crate::ffui_core::domain::{JobType, TranscodeJob};

pub(super) fn collect_job_tmp_cleanup_paths(job: &TranscodeJob) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();

    // 1) Known pause/resume segment artifacts.
    if let Some(meta) = job.wait_metadata.as_ref() {
        for path in super::super::job_runner::collect_wait_metadata_cleanup_paths(meta) {
            if seen.insert(path.clone()) {
                out.push(path);
            }
        }
    }

    if job.job_type != JobType::Video {
        return out;
    }

    // 2) Derive additional artifacts that can be left behind even when
    // wait_metadata is missing/incomplete (e.g. crash timing, refactors).
    let mut segments: BTreeMap<u64, PathBuf> = BTreeMap::new();
    if let Some(output_path) = job
        .output_path
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        discover_segments_for_output_path(Path::new(output_path), job.id.as_str(), &mut segments);
        for path in collect_output_based_tmp_artifacts(Path::new(output_path)) {
            if seen.insert(path.clone()) {
                out.push(path);
            }
        }
    }

    let input_trimmed = job.filename.trim();
    if !input_trimmed.is_empty() {
        discover_segments_for_input_path(Path::new(input_trimmed), job.id.as_str(), &mut segments);
        if let Some(legacy_tmp) = build_legacy_video_tmp_output_path(Path::new(input_trimmed)) {
            if legacy_tmp.exists() && seen.insert(legacy_tmp.clone()) {
                out.push(legacy_tmp);
            }
        }
    }

    // Add all discovered segments plus associated marker/tmp artifacts.
    for (_idx, seg) in segments {
        if seen.insert(seg.clone()) {
            out.push(seg.clone());
        }
        let marker = seg.with_extension("noaudio.done");
        if seen.insert(marker.clone()) {
            out.push(marker);
        }
        if let Some(ext) = seg
            .extension()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
        {
            let tmp = seg.with_extension(format!("noaudio.tmp.{ext}"));
            if seen.insert(tmp.clone()) {
                out.push(tmp);
            }
        }
    }

    out
}

fn collect_output_based_tmp_artifacts(output_path: &Path) -> Vec<PathBuf> {
    let ext = output_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4");
    vec![
        output_path.with_extension("concat.list"),
        output_path.with_extension(format!("video.concat.tmp.{ext}")),
        output_path.with_extension(format!("concat.tmp.{ext}")),
    ]
}

fn build_legacy_video_tmp_output_path(input_path: &Path) -> Option<PathBuf> {
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

fn discover_segments_for_output_path(
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

fn discover_segments_for_input_path(
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
        if let Some(expected) = expected_ext {
            if !ext.eq_ignore_ascii_case(expected) {
                continue;
            }
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
