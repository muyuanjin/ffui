use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use super::super::segment_discovery;
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
        segment_discovery::discover_segments_for_output_path(
            Path::new(output_path),
            job.id.as_str(),
            &mut segments,
        );
        for path in collect_output_based_tmp_artifacts(Path::new(output_path)) {
            if seen.insert(path.clone()) {
                out.push(path);
            }
        }
    }

    let input_trimmed = job.filename.trim();
    if !input_trimmed.is_empty() {
        segment_discovery::discover_segments_for_input_path(
            Path::new(input_trimmed),
            job.id.as_str(),
            &mut segments,
        );
        if let Some(legacy_tmp) =
            segment_discovery::build_legacy_video_tmp_output_path(Path::new(input_trimmed))
            && legacy_tmp.exists()
            && seen.insert(legacy_tmp.clone())
        {
            out.push(legacy_tmp);
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
